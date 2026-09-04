-- Migration: add session_version to users for server-side logout support.
--
-- AuthController::logout() increments this counter for the current user;
-- the value is also embedded in every JWT issued at login. Every
-- authenticated request (AuthMiddleware::authenticate()) then rejects any
-- token whose embedded session_version doesn't exactly match the user's
-- current one — closing the gap where a stateless JWT kept working after
-- the user "logged out." Also incremented on password reset/change
-- (AuthController::resetPassword(), UserController::update()) so a stolen
-- token can't outlive a password change either.
--
-- A monotonic counter, not a timestamp: an earlier version of this migration
-- used a `session_invalidated_at` DATETIME compared against the JWT's `iat`,
-- but iat/NOW() both only have 1-second resolution, and a login immediately
-- followed by its own logout (not a rare case — e.g. any quick test or
-- re-auth flow) regularly ties at the same second. A tie made the old token
-- permanently escape invalidation (`iat < invalidated_at` is false when
-- equal) rather than glitch for a moment. An integer equality check has no
-- such collision.
--
-- Invalidates every session for that user at once — there's no per-token
-- tracking, only this one counter — so logging out (or changing password)
-- on one device signs the user out everywhere. That's the simplest correct
-- behavior without adding a dedicated sessions table.
--
-- Deployment note: any token already issued before this ships has no
-- session_version claim at all and will be treated as stale, so every
-- currently logged-in user is signed out once on deploy — a one-time,
-- expected effect of introducing this claim, not a bug.
-- Run this once against the application database.

ALTER TABLE `users`
  ADD COLUMN `session_version` INT NOT NULL DEFAULT 1 AFTER `last_login`;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260904_add_session_invalidation.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
