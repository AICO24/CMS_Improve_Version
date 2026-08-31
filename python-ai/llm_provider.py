"""
LLM provider abstraction with sequential fallback (Batch 4 + Batch 6).

Isolates every provider-SDK-specific detail (client init, API key handling,
request formatting, JSON-mode translation, timeout handling, response
extraction, exception classification) behind one small generate() function,
so business-logic call sites in app.py (_extract_preferences,
_answer_question, _explain_exception, _explain_entity, _ask_assistant)
depend only on this provider-neutral interface and never import a provider
SDK themselves.

Batch 6 adds an explicit, sequential provider_chain to generate(). Gemini
remains the primary provider for every call site. Only the one call site
that opts in (currently /api/assistant-ask, wired in app.py) passes a
two-entry chain — every other call site omits provider_chain entirely and
keeps behaving exactly as it did before this batch (Gemini only).

Backup provider: Groq (chosen per the Batch 5 audit's capability matrix —
independent failure domain from Google/Gemini, plain HTTPS JSON API with
no new SDK dependency needed, system-instruction/JSON-mode/temperature/
max-token support, low latency, free developer tier). Reached over plain
HTTPS via the standard library only (urllib) — no new pip dependency, no
change to requirements.txt. An unconfigured backup (no GROQ_API_KEY) fails
safely: generate() simply never advances past a chain position for it
without ever attempting a network call.

There is no fallback *within* a single provider (no same-provider retry,
no backoff, no racing/parallel attempts) — the chain is walked forward,
at most once per provider per request, per Batch 6's explicit scope.
"""
import json
import logging
import os
import socket
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

logger = logging.getLogger('llm_provider')

# The Gemini API rejects any HttpOptions.timeout below 10s outright (400
# INVALID_ARGUMENT) — unlike the old Anthropic client's 8.0s, which was just
# a client-side cutoff. 12s leaves a small margin above that hard floor.
DEFAULT_TIMEOUT_MS = 12000

# Only 'gemini' is a valid DEFAULT (solo) provider — an unset/unrecognized
# value fails safely to it rather than crashing at import time or silently
# turning every AI feature off. 'backup' is never a default/solo provider;
# it only ever appears as an explicit second entry in a caller-supplied
# provider_chain (see app.py's _ask_assistant()).
AI_PROVIDER = (os.getenv('AI_PROVIDER') or 'gemini').strip().lower()
if AI_PROVIDER != 'gemini':
    AI_PROVIDER = 'gemini'
DEFAULT_PROVIDER_CHAIN: List[str] = [AI_PROVIDER]

# Small, plain-dict provider configuration (Batch 6) — deliberately not a
# class hierarchy; this project has exactly two providers and each needs
# only a couple of settings, so a dict-of-dicts matches the existing
# codebase's own convention (e.g. app.py's DB_CONFIG) rather than
# introducing new ceremony for its own sake.
PROVIDER_CONFIG: Dict[str, Dict[str, Any]] = {
    'gemini': {
        'api_key_env': 'GEMINI_API_KEY',
    },
    'backup': {
        'api_key_env': 'GROQ_API_KEY',
        # Gemini model names (e.g. 'gemini-3.6-flash') are meaningless to
        # Groq, so the backup provider always uses its own fixed default
        # rather than trying to reinterpret the caller's `model` argument
        # — callers never need to know this; `model=` continues to mean
        # "which Gemini model" exactly as before.
        'default_model': 'llama-3.1-8b-instant',
    },
}

# Failure categories eligible to advance the chain to the next provider.
# 'invalid_model' and 'empty_output' are deliberately excluded — see
# _FALLBACK_ELIGIBLE_CATEGORIES's usage in generate() below and the
# category docstring notes on _classify_gemini_exception()/
# _classify_http_status() for why.
_FALLBACK_ELIGIBLE_CATEGORIES = {'config', 'temporary', 'rate_limit', 'timeout'}

_gemini_api_key = (os.getenv('GEMINI_API_KEY') or '').strip()
_gemini_client = genai.Client(api_key=_gemini_api_key) if _gemini_api_key else None

_backup_api_key = (os.getenv(PROVIDER_CONFIG['backup']['api_key_env']) or '').strip()

# gemini-3.6-flash spends part of max_output_tokens on internal "thinking"
# before the visible answer — thinking_budget=0 is rejected outright for
# this model (400 INVALID_ARGUMENT), so 'low' plus a generous per-call
# token budget is the fix; without it, short structured-JSON responses were
# silently getting cut off mid-object (verified while debugging the extract
# endpoint returning null for every request). Every current Gemini call
# site wants the same setting, so it's a fixed internal default rather than
# a per-call parameter — there is nothing to normalize across providers
# for this, since it's a Gemini-only quirk with no Groq equivalent.
_GEMINI_THINKING_CONFIG = genai_types.ThinkingConfig(thinking_level='low')


def is_configured() -> bool:
    """True when the primary (Gemini) provider has everything it needs to run."""
    return _gemini_client is not None


def _classify_gemini_exception(exc: Exception) -> str:
    """
    Best-effort classification of a google-genai SDK exception into one of
    the failure categories generate() understands.

    Caveat: the exact google-genai exception surface could not be verified
    against a live install in this environment. This reads common
    attribute names (`code`/`status_code`) defensively and falls back to a
    message substring match, defaulting to 'temporary' (fallback-eligible)
    for anything unrecognized — an unclassified infrastructure error should
    not be permanently hidden from the chain, but 'config'/'invalid_model'
    are only ever returned on a positively-identified signal, never as a
    default guess, since those two categories carry real consequences
    (config: eligible for fallback; invalid_model: NOT eligible, and
    intentionally surfaces rather than hides a deployment bug).
    """
    status_code = getattr(exc, 'code', None)
    if not isinstance(status_code, int):
        status_code = getattr(exc, 'status_code', None)
    message = str(exc).lower()

    if isinstance(status_code, int):
        if status_code in (401, 403):
            return 'config'
        if status_code == 429:
            return 'rate_limit'
        if status_code == 404:
            return 'invalid_model'
        if status_code >= 500:
            return 'temporary'

    if 'timeout' in message or 'deadline' in message or isinstance(exc, TimeoutError):
        return 'timeout'
    if 'quota' in message or 'rate limit' in message or 'resource_exhausted' in message:
        return 'rate_limit'
    if 'model' in message and (
        'not found' in message or 'does not exist' in message or 'unsupported' in message or 'not supported' in message
    ):
        return 'invalid_model'
    if ('api key' in message or 'api_key' in message or 'unauthenticated' in message or 'permission denied' in message):
        return 'config'

    return 'temporary'


def _generate_with_gemini(
    system_prompt: str,
    user_content: str,
    *,
    model: str,
    json_mode: bool,
    temperature: float,
    max_output_tokens: int,
    timeout_ms: int,
) -> Tuple[Optional[str], Optional[str]]:
    """Returns (text, failure_category). failure_category is None on success."""
    if _gemini_client is None:
        return None, 'config'

    try:
        config_kwargs: Dict[str, Any] = {
            'system_instruction': system_prompt,
            'max_output_tokens': max_output_tokens,
            'temperature': temperature,
            'thinking_config': _GEMINI_THINKING_CONFIG,
            'http_options': genai_types.HttpOptions(timeout=timeout_ms),
        }
        if json_mode:
            config_kwargs['response_mime_type'] = 'application/json'

        response = _gemini_client.models.generate_content(
            model=model,
            contents=user_content,
            config=genai_types.GenerateContentConfig(**config_kwargs),
        )
        text = (response.text or '').strip()
        if not text:
            # A valid, empty response — not a provider failure (see module
            # docstring / _FALLBACK_ELIGIBLE_CATEGORIES) — never advances
            # the chain, matches the pre-Batch-6 behavior of collapsing
            # empty text straight to "no answer" for the caller.
            return None, 'empty_output'
        return text, None
    except Exception as exc:
        return None, _classify_gemini_exception(exc)


def _classify_http_status(status_code: int, body_text: str) -> str:
    if status_code in (401, 403):
        return 'config'
    if status_code == 429:
        return 'rate_limit'
    if status_code == 404:
        return 'invalid_model'
    if status_code >= 500:
        return 'temporary'
    lowered = (body_text or '').lower()
    if 'model' in lowered and ('not found' in lowered or 'does not exist' in lowered or 'decommissioned' in lowered):
        return 'invalid_model'
    # Any other 4xx: no positively-identified config/model signal in the
    # body — default to 'temporary' (fallback-eligible) rather than
    # guessing 'invalid_model', for the same reason described in
    # _classify_gemini_exception()'s docstring.
    return 'temporary'


def _generate_with_backup(
    system_prompt: str,
    user_content: str,
    *,
    json_mode: bool,
    temperature: float,
    max_output_tokens: int,
    timeout_ms: int,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Groq, via its plain OpenAI-compatible HTTPS chat-completions endpoint.
    Uses only the standard library (urllib) — no new dependency, no change
    to requirements.txt. Returns (text, failure_category), same contract
    as _generate_with_gemini().
    """
    if not _backup_api_key:
        return None, 'config'

    body: Dict[str, Any] = {
        'model': PROVIDER_CONFIG['backup']['default_model'],
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_content},
        ],
        'temperature': temperature,
        'max_tokens': max_output_tokens,
    }
    if json_mode:
        body['response_format'] = {'type': 'json_object'}

    request = urllib.request.Request(
        'https://api.groq.com/openai/v1/chat/completions',
        data=json.dumps(body).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {_backup_api_key}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_ms / 1000) as response:
            parsed = json.loads(response.read().decode('utf-8'))
            choices = parsed.get('choices') or []
            text = ((choices[0].get('message') or {}).get('content') or '').strip() if choices else ''
            if not text:
                return None, 'empty_output'
            return text, None
    except urllib.error.HTTPError as exc:
        try:
            body_text = exc.read().decode('utf-8', errors='ignore')
        except Exception:
            body_text = ''
        return None, _classify_http_status(exc.code, body_text)
    except socket.timeout:
        return None, 'timeout'
    except urllib.error.URLError as exc:
        if isinstance(getattr(exc, 'reason', None), socket.timeout):
            return None, 'timeout'
        return None, 'temporary'
    except Exception:
        return None, 'temporary'


def _log_attempt(provider_name: str, model_name: str, success: bool, failure_category: Optional[str], duration_ms: int, chain_position: int) -> None:
    # Metadata only — never a prompt, message, fact payload, conversation
    # history, raw provider response, or exception body. See module
    # docstring / Batch 5 audit Part 11 for why.
    fields = [
        f'provider={provider_name}',
        f'model={model_name}',
        f'success={str(success).lower()}',
    ]
    if not success and failure_category:
        fields.append(f'failure_category={failure_category}')
    fields.append(f'duration_ms={duration_ms}')
    fields.append(f'chain_position={chain_position}')
    fields.append(f'fallback_triggered={str(chain_position > 1).lower()}')
    logger.info('AI provider attempt: %s', ' '.join(fields))


def generate(
    system_prompt: str,
    user_content: str,
    *,
    model: str,
    json_mode: bool = False,
    temperature: float = 0.3,
    max_output_tokens: int = 512,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    provider_chain: Optional[List[str]] = None,
) -> Optional[str]:
    """
    Provider-neutral text generation, walked sequentially across an
    optional provider_chain (default: DEFAULT_PROVIDER_CHAIN, i.e. Gemini
    only — identical to pre-Batch-6 behavior for every call site that
    doesn't pass provider_chain explicitly).

    Returns the raw response text from the first provider in the chain
    that succeeds, or None once every eligible attempt in the chain has
    been exhausted. Every existing caller already treats None as "AI
    unavailable" and falls back to its own deterministic behavior, so no
    exception ever crosses this boundary.

    Chain walking rules (Batch 6):
    - Sequential only — never parallel, never a race.
    - At most one attempt per provider per request; a provider already
      attempted is never revisited.
    - A failure only advances the chain when its category is fallback-
      eligible (config / temporary / rate_limit / timeout). 'invalid_model'
      stops the chain immediately (a misconfigured model name is a
      deployment bug that should surface, not be silently masked by a
      different provider quietly taking over forever). A valid-but-empty
      response ('empty_output') also stops the chain — an empty answer is
      not a provider failure. Malformed JSON is not detectable here at
      all: generate() never parses JSON (see _strip_json_fences()/
      json.loads() in app.py), so a syntactically-broken-but-non-empty
      response is, from this function's point of view, a success — this
      is by design, not an oversight (Category F in the Batch 5 audit is
      a business-logic-level concept, not a provider-layer one).

    json_mode=True asks the active provider to return a raw JSON string
    (no markdown fences) when the provider supports it. This function only
    generates text — it never parses or validates JSON itself.
    """
    chain = provider_chain if provider_chain else DEFAULT_PROVIDER_CHAIN

    for position, provider_name in enumerate(chain, start=1):
        started = time.monotonic()

        if provider_name == 'gemini':
            text, category = _generate_with_gemini(
                system_prompt, user_content, model=model, json_mode=json_mode,
                temperature=temperature, max_output_tokens=max_output_tokens, timeout_ms=timeout_ms,
            )
            model_name = model
        elif provider_name == 'backup':
            text, category = _generate_with_backup(
                system_prompt, user_content, json_mode=json_mode,
                temperature=temperature, max_output_tokens=max_output_tokens, timeout_ms=timeout_ms,
            )
            model_name = PROVIDER_CONFIG['backup']['default_model']
        else:
            # An unrecognized chain entry fails safely as a configuration
            # problem rather than crashing — never attempts any network call.
            text, category = None, 'config'
            model_name = provider_name

        duration_ms = int((time.monotonic() - started) * 1000)
        _log_attempt(provider_name, model_name, text is not None, category, duration_ms, position)

        if text is not None:
            return text

        if category not in _FALLBACK_ELIGIBLE_CATEGORIES:
            break

    return None
