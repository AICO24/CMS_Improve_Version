<?php
// Minimal, dependency-free, file-based rate limiter (Batch 10).
//
// This codebase has no framework (plain PHP router, no Laravel or any
// other framework anywhere in backend/) so there is no existing
// rate-limiting facility to reuse. This is a small, self-contained
// substitute, scoped narrowly to ai/assistant-ask per the Batch 9 audit
// finding that it had zero server-side protection against rapid repeated
// calls — each one a real Gemini/Groq request.
//
// Fixed-window counter, one small JSON file per identity key under
// backend/storage/rate_limits/ (created on first use) — no new database
// table, per this batch's explicit "avoid migrations unless unavoidable"
// instruction. flock() makes concurrent access from multiple PHP workers
// on the same machine safe, which matches this project's actual
// deployment (a single Laragon instance), not a distributed cluster.
class RateLimiter {
    // Returns true if this call is allowed (and records it against the
    // count), false if $key has already made $limit or more calls within
    // the current $windowSeconds window.
    public static function allow($key, $limit, $windowSeconds) {
        $dir = STORAGE_ROOT . '/rate_limits';
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }

        $safeKey = preg_replace('/[^a-zA-Z0-9_-]/', '_', (string) $key);
        $path = $dir . '/' . $safeKey . '.json';

        $handle = @fopen($path, 'c+');
        if ($handle === false) {
            // Storage unavailable — fail open rather than blocking the
            // whole AI assistant over an unrelated filesystem problem.
            // The endpoint's own Gemini/Groq call still has its own
            // timeout/fallback safety net regardless of this decision.
            return true;
        }

        flock($handle, LOCK_EX);
        $contents = stream_get_contents($handle);
        $state = json_decode($contents, true);

        $now = time();
        $windowStart = intdiv($now, $windowSeconds) * $windowSeconds;

        if (!is_array($state) || ($state['window_start'] ?? null) !== $windowStart) {
            $state = ['window_start' => $windowStart, 'count' => 0];
        }

        $state['count']++;
        $allowed = $state['count'] <= $limit;

        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($state));
        fflush($handle);
        flock($handle, LOCK_UN);
        fclose($handle);

        return $allowed;
    }
}
