CREATE TABLE IF NOT EXISTS external_game_ids (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  game_id     INT NOT NULL,
  source      ENUM('igdb','steam_appid','psn_concept','rawg') NOT NULL,
  external_id VARCHAR(255) NOT NULL,
  created_at  DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_external_game_id (source, external_id),
  KEY idx_game_id (game_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
