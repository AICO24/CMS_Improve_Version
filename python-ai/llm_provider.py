"""
Minimal LLM provider abstraction (Batch 4).

Isolates every Gemini-SDK-specific detail (client init, API key handling,
ThinkingConfig, GenerateContentConfig, HttpOptions, response text
extraction) behind one small generate() function, so the business-logic
call sites in app.py (_extract_preferences, _answer_question,
_explain_exception, _explain_entity, _ask_assistant) depend only on this
provider-neutral interface and never import `google.genai` themselves.

Gemini remains the only implemented/active provider — this is an
abstraction boundary, not a multi-provider router. AI_PROVIDER selects
which provider backs generate(); only 'gemini' is implemented, and an
unset/unrecognized value safely falls back to it rather than crashing or
silently disabling AI features. There is no fallback *between* providers
at request time — exactly one provider backs every call.
"""
import os
from typing import Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

# The Gemini API rejects any HttpOptions.timeout below 10s outright (400
# INVALID_ARGUMENT) — unlike the old Anthropic client's 8.0s, which was just
# a client-side cutoff. 12s leaves a small margin above that hard floor.
DEFAULT_TIMEOUT_MS = 12000

# Only 'gemini' is implemented in this batch. An unset/unrecognized value
# fails safely to the one working provider rather than crashing at import
# time or silently turning every AI feature off.
AI_PROVIDER = (os.getenv('AI_PROVIDER') or 'gemini').strip().lower()
if AI_PROVIDER != 'gemini':
    AI_PROVIDER = 'gemini'

_gemini_api_key = (os.getenv('GEMINI_API_KEY') or '').strip()
_gemini_client = genai.Client(api_key=_gemini_api_key) if _gemini_api_key else None

# gemini-3.6-flash spends part of max_output_tokens on internal "thinking"
# before the visible answer — thinking_budget=0 is rejected outright for
# this model (400 INVALID_ARGUMENT), so 'low' plus a generous per-call
# token budget is the fix; without it, short structured-JSON responses were
# silently getting cut off mid-object (verified while debugging the extract
# endpoint returning null for every request). Every current call site wants
# the same setting, so it's a fixed internal default rather than a
# per-call parameter — there is nothing to normalize across providers yet.
_GEMINI_THINKING_CONFIG = genai_types.ThinkingConfig(thinking_level='low')


def is_configured() -> bool:
    """True when the active provider has everything it needs to run."""
    return _gemini_client is not None


def generate(
    system_prompt: str,
    user_content: str,
    *,
    model: str,
    json_mode: bool = False,
    temperature: float = 0.3,
    max_output_tokens: int = 512,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> Optional[str]:
    """
    Provider-neutral text generation.

    Returns the raw response text, or None on any failure — provider not
    configured (no API key), timeout, SDK/API error, or an empty response.
    Every existing caller already treats None as "AI unavailable" and falls
    back to its own deterministic behavior, so no exception ever needs to
    cross this boundary; callers do not need their own try/except around
    this call for that reason.

    json_mode=True asks the provider to return a raw JSON string (no
    markdown fences) when the provider supports it. This function only
    generates text — it never parses or validates JSON itself, so callers
    that need a dict still parse the returned string themselves (see
    _strip_json_fences()/json.loads() in app.py). That keeps JSON-shape
    validation, which is specific to each endpoint's own schema, out of
    the provider boundary.
    """
    if _gemini_client is None:
        return None

    try:
        config_kwargs = {
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
        return text or None
    except Exception:
        return None
