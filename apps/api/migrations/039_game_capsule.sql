-- Wide store capsule art (~460x215), distinct from cover_path (portrait box-art)
-- and hero_path (1920x620 library banner).
--
-- Stored rather than derived: only older Steam apps live at the predictable
-- /steam/apps/<appid>/header.jpg path. Newer ones sit under a content-hash
-- directory with _alt_assets suffixes, so the URL has to come from the store API.
ALTER TABLE games ADD COLUMN capsule_path VARCHAR(1000) NULL;
