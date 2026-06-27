CREATE TABLE IF NOT EXISTS merge_log (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NOT NULL,
  winner_game_id INT NOT NULL,
  loser_game_id  INT NOT NULL,
  moved          JSON NULL,
  created_at     DATETIME DEFAULT NOW(),
  KEY idx_merge_log_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
