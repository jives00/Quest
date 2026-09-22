-- status-lists-finalize.sql
--
-- ONE-WAY DOOR, and deliberately NOT in apps/api/migrations/ — the runner
-- applies every .sql in that directory in one pass, so leaving it there would
-- mean `pnpm --filter api migrate` slamming this door the moment 042 landed.
-- Run it by hand, against the quest database, only after BOTH:
--
--   1. the manual `other` pass is done — every row in `status_other_snapshot`
--      has been given a real status, and the endless ones added to the Endless
--      list (nothing here can tell an endless game from a media player), and
--   2. the new APK is installed, so nothing is still sending `other`.
--
-- Anything still sitting on `other` when this runs becomes `completed`.
-- See apps/api/scripts/status-lists-data-pass.sql for step 1.

UPDATE game_status SET status = 'completed' WHERE status = 'other';

-- Drops `unplayed` for good; 042 already emptied it.
ALTER TABLE game_status
  MODIFY COLUMN status
    ENUM('wishlist','backlog','playing','completed','skipped')
    NOT NULL;

-- play_history narrows rather than widens: Wishlist/Backlog/Skipped are not
-- play events, so history only ever needs playing/completed.
UPDATE play_history SET status = 'completed' WHERE status = 'other';

ALTER TABLE play_history
  MODIFY COLUMN status ENUM('playing','completed') NULL;

-- Retire the Backlog and Wishlist system lists. Their membership was copied
-- into game_status by 042, and the API has been hiding them since.
DELETE li FROM list_items li
  JOIN lists l ON l.id = li.list_id
 WHERE l.kind = 'system' AND l.system_key IN ('backlog','wishlist');

DELETE FROM lists WHERE kind = 'system' AND system_key IN ('backlog','wishlist');

ALTER TABLE lists
  MODIFY COLUMN system_key ENUM('replay','vr','endless') NULL;
