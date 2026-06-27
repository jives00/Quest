CREATE TABLE IF NOT EXISTS game_completions (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  game_id      INT NOT NULL,
  completed_at DATETIME NOT NULL,
  source       ENUM('status_change', 'manual') NOT NULL DEFAULT 'status_change',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  INDEX idx_gc_user_game (user_id, game_id)
);
