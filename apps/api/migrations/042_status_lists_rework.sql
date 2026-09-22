-- 042_status_lists_rework.sql
-- Statuses absorb the Backlog and Wishlist system lists.
--
-- "backlog" and "wishlist" existed as BOTH a status-adjacent system list and a
-- hand-maintained list, so the same fact lived in two places. They become
-- statuses here.
--
-- `unplayed` is renamed to `skipped` and changes meaning. It used to be the
-- silent default for everything owned-and-untouched; it is now a deliberate
-- choice — "I own this and I'm not going to play it." Nothing defaults to it,
-- so the old default rows are deleted rather than relabelled.
--
-- `other` is being retired too — it had quietly been doing two unrelated jobs
-- (endless games with no finish line, and Steam entries that aren't games at
-- all) — but it survives this migration so an older APK can keep sending it
-- until the new build ships.
--
-- This migration is additive and reversible. The narrowing step is NOT a
-- migration: see apps/api/scripts/status-lists-finalize.sql, which is run by
-- hand once the manual pass is done and the new APK is out.

-- ── 1. Snapshot the `other` rows ───────────────────────────────────────────
-- Once the ENUM narrows, the endless/not-a-game distinction is unrecoverable
-- from the data alone, and only a human can make the call. Keep the list.
CREATE TABLE IF NOT EXISTS status_other_snapshot (
  user_id     INT NOT NULL,
  game_id     INT NOT NULL,
  title       VARCHAR(512) NULL,
  snapshot_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO status_other_snapshot (user_id, game_id, title)
SELECT gs.user_id, gs.game_id, g.title
  FROM game_status gs
  JOIN games g ON g.id = gs.game_id
 WHERE gs.status = 'other';

-- ── 2. Widen the status ENUM ───────────────────────────────────────────────
-- Carries the old values and the new ones at once so the remaps below have
-- somewhere to land. The DEFAULT is dropped: there is no default status now.
ALTER TABLE game_status
  MODIFY COLUMN status
    ENUM('wishlist','unplayed','skipped','backlog','playing','completed','other')
    NOT NULL;

-- ── 3. Status change log ───────────────────────────────────────────────────
-- Replaces the activity feed's wishlist/backlog branches (which read
-- list_items.added_at, and have nothing to read once those lists retire), and
-- makes automation visible: a sync filing a new game under Backlog, or
-- detected playtime moving it to Playing, is no longer indistinguishable from
-- a manual edit.
CREATE TABLE IF NOT EXISTS status_changes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  game_id     INT NOT NULL,
  from_status VARCHAR(16) NULL,
  to_status   VARCHAR(16) NOT NULL,
  source      ENUM('manual','ownership_sync','playtime') NOT NULL DEFAULT 'manual',
  changed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  INDEX idx_sc_user_at (user_id, changed_at),
  INDEX idx_sc_user_game (user_id, game_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. The Endless system list ─────────────────────────────────────────────
-- No finish line (live service, sports, roguelikes). Doesn't affect status;
-- excluded from completion-rate stats. Hidden is NOT added as a list: the
-- `hidden_games` table already does exactly that job and is already excluded
-- from the library, dashboard and export.
ALTER TABLE lists
  MODIFY COLUMN system_key ENUM('backlog','wishlist','replay','vr','endless') NULL;

INSERT IGNORE INTO lists (user_id, slug, name, kind, system_key, sort_order)
SELECT id, 'endless', 'Endless', 'system', 'endless', 4 FROM users;

-- ── 5. Promote list membership to status ───────────────────────────────────
-- Wishlist members become status `wishlist` — unowned by definition, so any
-- recorded play status would be nonsense; overwrite unconditionally.
INSERT INTO game_status (user_id, game_id, status)
SELECT l.user_id, li.game_id, 'wishlist'
  FROM lists l
  JOIN list_items li ON li.list_id = l.id
 WHERE l.kind = 'system' AND l.system_key = 'wishlist'
ON DUPLICATE KEY UPDATE status = 'wishlist';

-- Backlog members become status `backlog`, but only where nothing more
-- specific is already recorded: a backlog-list game that is actually being
-- played, or already finished, keeps the truer status.
INSERT INTO game_status (user_id, game_id, status)
SELECT l.user_id, li.game_id, 'backlog'
  FROM lists l
  JOIN list_items li ON li.list_id = l.id
 WHERE l.kind = 'system' AND l.system_key = 'backlog'
ON DUPLICATE KEY UPDATE
  status = IF(game_status.status = 'unplayed', 'backlog', game_status.status);

-- ── 6. Retire `unplayed` ───────────────────────────────────────────────────
-- Must run AFTER step 5, which still reads 'unplayed' to decide what the
-- Backlog list may overwrite.
--
-- An 'unplayed' row was the old default, written for every owned game whether
-- or not you had an opinion about it. It asserts nothing, and keeping it would
-- make the whole untouched library read as "Skipped" — the opposite of what
-- Skipped now means. Delete those rows; absence of a row is the new resting
-- state.
DELETE FROM game_status
 WHERE status = 'unplayed' AND started_at IS NULL AND finished_at IS NULL;

-- Anything still on 'unplayed' has real dates attached, so it carries history
-- worth keeping. Those become `skipped`.
UPDATE game_status SET status = 'skipped' WHERE status = 'unplayed';
