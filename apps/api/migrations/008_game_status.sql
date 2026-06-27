CREATE TABLE IF NOT EXISTS game_status (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  game_id     INT NOT NULL,
  status      ENUM('unplayed','playing','beaten','completed','dropped') NOT NULL DEFAULT 'unplayed',
  started_at  DATETIME NULL,
  finished_at DATETIME NULL,
  created_at  DATETIME DEFAULT NOW(),
  updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW(),
  UNIQUE KEY uq_game_status (user_id, game_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
