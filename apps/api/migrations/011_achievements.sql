CREATE TABLE IF NOT EXISTS achievements (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  game_id    INT NOT NULL,
  source     ENUM('steam','psn') NOT NULL,
  api_name   VARCHAR(255) NOT NULL,
  name       VARCHAR(500) NOT NULL,
  icon       VARCHAR(500) NULL,
  created_at DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_achievement (game_id, source, api_name),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_achievements (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  game_id     INT NOT NULL,
  api_name    VARCHAR(255) NOT NULL,
  unlocked_at DATETIME NULL,
  created_at  DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_user_achievement (user_id, game_id, api_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
