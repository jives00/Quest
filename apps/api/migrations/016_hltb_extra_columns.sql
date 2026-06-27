-- 016_hltb_extra_columns.sql
-- Adds Main+Extras and Completionist HLTB columns alongside the existing main-story column.

ALTER TABLE games
  ADD COLUMN hltb_main_extra_hours    DECIMAL(5,1) NULL,
  ADD COLUMN hltb_completionist_hours DECIMAL(5,1) NULL;
