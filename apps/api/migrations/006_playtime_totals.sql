CREATE TABLE IF NOT EXISTS playtime_totals (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NOT NULL,
  game_id        INT NOT NULL,
  source         ENUM('steam','psn') NOT NULL,
  total_minutes  INT NOT NULL DEFAULT 0,
  last_synced_at DATETIME NULL,
  created_at     DATETIME DEFAULT NOW(),
  updated_at     DATETIME DEFAULT NOW() ON UPDATE NOW(),
  UNIQUE KEY uq_playtime_total (user_id, game_id, source),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
