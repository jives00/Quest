-- Manual data pass for the status & lists rework. NOT a migration — nothing
-- runs this for you. Work through it between migration 042 and
-- apps/api/scripts/status-lists-finalize.sql.
--
-- 042 already promoted Wishlist and Backlog list membership to statuses. What
-- is left is the part no rule can automate: `other` was doing two unrelated
-- jobs, and only you know which rows are endless games and which are Steam
-- entries that aren't games at all.

-- ── 0. Account for every owned game ────────────────────────────────────────
-- The dashboard's "games owned" counts DISTINCT ownership rows minus hidden,
-- while its panels only show playing/backlog/completed. Anything on another
-- status — or on none at all — is owned but invisible there. This buckets all
-- of them so the numbers reconcile. (user_id 1 throughout; adjust if not.)
SELECT COALESCE(gs.status, '(no status)') AS status, COUNT(*) AS n
  FROM (SELECT DISTINCT o.user_id, o.game_id FROM ownership o WHERE o.user_id = 1) og
  LEFT JOIN game_status gs ON gs.user_id = og.user_id AND gs.game_id = og.game_id
 WHERE NOT EXISTS (
       SELECT 1 FROM hidden_games h
        WHERE h.user_id = og.user_id AND h.game_id = og.game_id)
 GROUP BY 1
 ORDER BY n DESC;

-- Name the ones the home page doesn't show.
SELECT g.id, g.title, COALESCE(gs.status, '(no status)') AS status
  FROM (SELECT DISTINCT o.user_id, o.game_id FROM ownership o WHERE o.user_id = 1) og
  JOIN games g ON g.id = og.game_id
  LEFT JOIN game_status gs ON gs.user_id = og.user_id AND gs.game_id = og.game_id
 WHERE NOT EXISTS (
       SELECT 1 FROM hidden_games h
        WHERE h.user_id = og.user_id AND h.game_id = og.game_id)
   AND (gs.status IS NULL OR gs.status NOT IN ('completed', 'playing', 'backlog'))
 ORDER BY status, g.title;

-- Owned, but migration 042 set them to `wishlist`. Step 5 of 042 overwrites
-- unconditionally on the premise that a wishlisted game is unowned by
-- definition — which is false for anything that stayed on the Steam wishlist
-- after you bought it. A non-zero `completions` column means a real status was
-- overwritten; the completion records survive, so it is recoverable.
SELECT g.id, g.title,
       (SELECT COUNT(*) FROM game_completions gc
         WHERE gc.user_id = gs.user_id AND gc.game_id = gs.game_id) AS completions
  FROM game_status gs
  JOIN games g ON g.id = gs.game_id
 WHERE gs.status = 'wishlist'
   AND EXISTS (SELECT 1 FROM ownership o
                WHERE o.user_id = gs.user_id AND o.game_id = gs.game_id)
 ORDER BY completions DESC, g.title;

-- ── 1. What needs deciding ─────────────────────────────────────────────────
SELECT s.game_id, s.title, gs.status AS current_status
  FROM status_other_snapshot s
  JOIN game_status gs ON gs.user_id = s.user_id AND gs.game_id = s.game_id
 WHERE gs.status = 'other'
 ORDER BY s.title;

-- ── 2. Endless games (live service, sports, roguelikes) ────────────────────
-- Onto the Endless list, plus a real status — Endless is classification, it
-- never stands in for one. An endless game has no completion to reach, so its
-- status is either `playing` (still in it) or `completed` (done with it, which
-- is what Completed has always meant for something dropped). Endless
-- membership is what keeps it out of the completion-rate stats either way.
--
-- INSERT IGNORE INTO list_items (list_id, game_id)
-- SELECT l.id, g.id FROM lists l JOIN games g ON g.id IN (/* game ids */)
--  WHERE l.user_id = /* user id */ AND l.system_key = 'endless';
--
-- UPDATE game_status SET status = 'playing'
--  WHERE user_id = /* user id */ AND game_id IN (/* game ids */);

-- ── 3. Not actually games (media players, tools) ───────────────────────────
-- These go to `hidden_games`, which already excludes them from the library,
-- dashboard, stats and export.
--
-- Delete the status row rather than setting one. There is no default status
-- any more, so absence is a legal resting state — and "I completed DeoVR Video
-- Player" is not a claim worth storing. status_other_snapshot keeps the record
-- if you ever want it back.
--
-- INSERT IGNORE INTO hidden_games (user_id, game_id)
-- SELECT /* user id */, id FROM games WHERE id IN (/* game ids */);
--
-- DELETE FROM game_status
--  WHERE user_id = /* user id */ AND game_id IN (/* game ids */);

-- ── 4. Anything left ───────────────────────────────────────────────────────
-- status-lists-finalize.sql sweeps the remainder into `completed`. Check the
-- list is one you'd accept before running it:
SELECT COUNT(*) AS still_other FROM game_status WHERE status = 'other';

-- ── 5. Verify ──────────────────────────────────────────────────────────────
-- Games with no status at all are the resting state now, so expect the counts
-- below to sum to far less than your library size.
SELECT status, COUNT(*) FROM game_status GROUP BY status;

-- Replay should have come through untouched.
SELECT l.name, COUNT(li.game_id) AS items
  FROM lists l LEFT JOIN list_items li ON li.list_id = l.id
 WHERE l.kind = 'system'
 GROUP BY l.id, l.name;
