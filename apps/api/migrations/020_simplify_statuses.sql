-- Migrate existing 'beaten' → 'completed' and 'dropped' → 'other', then
-- narrow the ENUM to the four statuses we actually use.

-- Step 1: remap rows while the column still allows all old values
UPDATE game_status SET status = 'completed' WHERE status = 'beaten';
UPDATE game_status SET status = 'other'     WHERE status = 'dropped';

UPDATE play_history SET status = 'completed' WHERE status = 'beaten';
UPDATE play_history SET status = 'other'     WHERE status = 'dropped';

-- Step 2: lock the ENUM to the new set
ALTER TABLE game_status
  MODIFY COLUMN status ENUM('unplayed','playing','completed','other') NOT NULL DEFAULT 'unplayed';

ALTER TABLE play_history
  MODIFY COLUMN status ENUM('playing','completed','other') NULL;
