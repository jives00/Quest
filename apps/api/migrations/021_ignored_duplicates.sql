CREATE TABLE IF NOT EXISTS ignored_duplicates (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  game1_id   INT NOT NULL,
  game2_id   INT NOT NULL,
  created_at DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_ignored (user_id, game1_id, game2_id),
  KEY idx_ignored_user (user_id),
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (game1_id) REFERENCES games(id)  ON DELETE CASCADE,
  FOREIGN KEY (game2_id) REFERENCES games(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
