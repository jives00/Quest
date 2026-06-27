-- 015_game_enrichment.sql
-- Adds Steam store enrichment columns to games and a per-user hidden_games table.

ALTER TABLE games
  ADD COLUMN steam_review_desc  VARCHAR(64)                  NULL,
  ADD COLUMN steam_review_pct   TINYINT UNSIGNED             NULL,
  ADD COLUMN steam_review_count INT UNSIGNED                 NULL,
  ADD COLUMN controller_support ENUM('none','partial','full') NULL,
  ADD COLUMN metacritic_url     VARCHAR(500)                 NULL,
  ADD COLUMN store_fetched_at   DATETIME                     NULL;

CREATE TABLE IF NOT EXISTS hidden_games (
  user_id   INT NOT NULL,
  game_id   INT NOT NULL,
  hidden_at DATETIME DEFAULT NOW(),
  PRIMARY KEY (user_id, game_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
