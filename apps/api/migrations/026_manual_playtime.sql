-- 026_manual_playtime.sql
-- Add 'hltb' and 'manual' as valid sources for playtime_totals.
-- 'hltb' is auto-populated when a game is completed and has no tracked time.
-- 'manual' is user-set and overrides any 'hltb' estimate.
ALTER TABLE playtime_totals
  MODIFY COLUMN source ENUM('steam','psn','xbox','epic','gog','meta_quest','hltb','manual') NOT NULL;
