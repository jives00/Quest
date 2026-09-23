-- Screenshot pipeline: Steam screenshots → review → wallpaper folder.
--
-- An agent on the gaming PC (tools/screenshot-sync/) uploads every new Steam
-- screenshot. The API stages the file, scores it (duplicate / blurry / dark),
-- and works out where any UI sits; the agent's GPU then paints that UI out with
-- LaMa and uploads a cleaned copy. The web review page decides keep/reject per
-- shot, and export copies the keepers into the NAS wallpaper share as
-- "Game Title (N).jpg", numbering on from whatever is already there.
--
-- Shots start as 'keep'. The auto-flags only ever demote to 'reject' while
-- status_source is still 'auto', so re-scoring a game after new uploads never
-- overrides a choice the user already made.
--
-- UI comes from three places, unioned into one per-shot mask:
--   * the game's static HUD mask (blocks that repeat pixel-for-pixel across
--     different scenes -- see computeHudMask), stored on disk, versioned by
--     games.hud_mask_version
--   * ui_boxes: text regions the agent's detector found in the subtitle band
--     and corners (the "Skip" prompt)
--   * manual_boxes: rectangles drawn in the review lightbox
-- Boxes are fractions of the frame (0-1) so they are resolution-independent.
CREATE TABLE IF NOT EXISTS screenshots (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  game_id              INT NOT NULL,
  source               ENUM('steam_appid','steam_nonsteam') NOT NULL,
  source_app_id        VARCHAR(20) NOT NULL,
  sha256               CHAR(64) NOT NULL,
  taken_at             DATETIME NOT NULL,
  width                INT NOT NULL,
  height               INT NOT NULL,
  staging_path         VARCHAR(500) NULL,
  cleaned_path         VARCHAR(500) NULL,
  status               ENUM('keep','reject','exported') NOT NULL DEFAULT 'keep',
  status_source        ENUM('auto','user') NOT NULL DEFAULT 'auto',
  dhash                BIGINT UNSIGNED NOT NULL,
  sharpness            FLOAT NOT NULL,
  luma_mean            FLOAT NOT NULL,
  luma_std             FLOAT NOT NULL,
  duplicate_of         INT NULL,
  hud_blocks           JSON NULL,
  ui_boxes             JSON NULL,
  manual_boxes         JSON NULL,
  has_ui               TINYINT(1) NOT NULL DEFAULT 0,
  mask_version         INT NOT NULL DEFAULT 0,
  inpaint_status       ENUM('none','queued','done','failed') NOT NULL DEFAULT 'none',
  inpaint_mask_version INT NULL,
  export_variant       ENUM('original','cleaned') NOT NULL DEFAULT 'original',
  exported_name        VARCHAR(500) NULL,
  exported_at          DATETIME NULL,
  created_at           DATETIME DEFAULT NOW(),
  updated_at           DATETIME DEFAULT NOW() ON UPDATE NOW(),
  UNIQUE KEY uq_screenshots_sha256 (sha256),
  KEY idx_screenshots_game_status (game_id, status),
  KEY idx_screenshots_inpaint (inpaint_status),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- screenshot_export_name overrides the title used for exported filenames
-- (IGDB titles carry ™, subtitles, etc. the wallpaper folder doesn't want).
ALTER TABLE games
  ADD COLUMN screenshot_export_name VARCHAR(255) NULL,
  ADD COLUMN hud_mask_version INT NOT NULL DEFAULT 0;
