CREATE TABLE IF NOT EXISTS play_sessions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  game_id      INT NOT NULL,
  source       ENUM('steam','psn') NOT NULL,
  started_at   DATETIME NOT NULL,
  ended_at     DATETIME NOT NULL,
  duration_min INT NOT NULL,
  derived      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   DATETIME DEFAULT NOW(),
  updated_at   DATETIME DEFAULT NOW() ON UPDATE NOW(),
  KEY idx_user_started (user_id, started_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
