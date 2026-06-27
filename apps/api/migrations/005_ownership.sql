CREATE TABLE IF NOT EXISTS ownership (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  game_id     INT NOT NULL,
  platform    ENUM('steam','psn') NOT NULL,
  acquired_at DATETIME NULL,
  created_at  DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_ownership (user_id, game_id, platform),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
