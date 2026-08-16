-- Protect a hand-picked capsule from the automated art passes.
--
-- match_status='manual' was doing double duty: it marks "the user corrected this
-- row" AND gated the capsule refresh in enrichGame. That conflates two things --
-- a title-only edit froze the game's Steam capsule forever (and Steam capsules
-- must keep refreshing, since the newer ones live under a content-hash path that
-- 404s once Valve reissues the art). It also did nothing for refresh-all, which
-- writes capsule_path directly and never looked at match_status at all.
--
-- A dedicated flag, mirroring vr_manual, says exactly one thing: this capsule was
-- chosen by hand, leave it alone.
ALTER TABLE games ADD COLUMN capsule_manual TINYINT(1) NOT NULL DEFAULT 0;

-- Backfill: treat any capsule on a user-corrected row that did NOT come from the
-- Steam store API as hand-picked. Erring toward protection -- a capsule wrongly
-- marked manual just stops auto-refreshing (and re-picking one in the editor sets
-- the flag anyway), while a wrongly-unmarked one gets silently clobbered again.
UPDATE games
   SET capsule_manual = 1
 WHERE match_status = 'manual'
   AND capsule_path IS NOT NULL
   AND capsule_path NOT LIKE 'https://shared.akamai.steamstatic.com/%'
   AND capsule_path NOT LIKE 'https://cdn.cloudflare.steamstatic.com/%';
