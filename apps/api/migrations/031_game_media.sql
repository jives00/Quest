-- 031_game_media.sql
-- YouTube trailer video IDs and IGDB screenshot image IDs sourced during enrichment.
ALTER TABLE games
  ADD COLUMN trailer_video_ids    JSON NULL,
  ADD COLUMN screenshot_image_ids JSON NULL;
