-- 017_multiplatform_enums.sql
-- Phase 2: widen the source/platform ENUMs (hardcoded ('steam','psn') in Phase 1)
-- to the full multi-platform set, and add Xbox-account + import bookkeeping columns.
-- ENUM MODIFY is idempotent — re-running applies the same definition with no error.

ALTER TABLE external_game_ids
  MODIFY COLUMN source ENUM('igdb','steam_appid','psn_concept','rawg','xbox','epic','gog','meta_quest') NOT NULL;

ALTER TABLE platform_accounts
  MODIFY COLUMN platform ENUM('steam','psn','xbox','epic','gog','meta_quest') NOT NULL;

ALTER TABLE platform_accounts
  ADD COLUMN xuid             VARCHAR(32) NULL,
  ADD COLUMN gamertag         VARCHAR(64) NULL,
  ADD COLUMN import_label     VARCHAR(64) NULL,
  ADD COLUMN last_imported_at DATETIME    NULL;

ALTER TABLE ownership
  MODIFY COLUMN platform ENUM('steam','psn','xbox','epic','gog','meta_quest') NOT NULL;

ALTER TABLE playtime_totals
  MODIFY COLUMN source ENUM('steam','psn','xbox','epic','gog','meta_quest') NOT NULL;

ALTER TABLE play_sessions
  MODIFY COLUMN source ENUM('steam','psn','xbox','epic','gog','meta_quest') NOT NULL;

ALTER TABLE now_playing
  MODIFY COLUMN source ENUM('steam','psn','xbox','epic','gog','meta_quest') NOT NULL;

ALTER TABLE achievements
  MODIFY COLUMN source ENUM('steam','psn','xbox','epic','gog','meta_quest') NOT NULL;
