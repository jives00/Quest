-- Hero banner art + user-editable freeform tags on the canonical games row.
-- hero_path: wide landscape art (SteamGridDB hero / RAWG background), distinct
--   from cover_path which holds portrait box-art.
-- tags: user-curated freeform labels, kept separate from IGDB-sourced genres.
ALTER TABLE games ADD COLUMN hero_path VARCHAR(1000) NULL;
ALTER TABLE games ADD COLUMN tags JSON NULL;
