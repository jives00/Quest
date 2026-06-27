-- 018_play_history.sql
-- Manual historical play log. Mined data (achievement/trophy unlock timestamps and
-- play_sessions) is NOT duplicated here — it is unioned at read time in the timeline
-- endpoint. This table only holds user-entered memories for games with no API trace
-- (retro / childhood / Quest): "beat Halo 3 sometime in 2008".
--
-- `precision` is a MySQL reserved word — must stay backticked.

CREATE TABLE IF NOT EXISTS play_history (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NOT NULL,
  game_id        INT NOT NULL,
  occurred_start DATE NULL,
  occurred_end   DATE NULL,
  `precision`    ENUM('exact','day','month','year','era') NOT NULL DEFAULT 'year',
  status         ENUM('playing','beaten','completed','dropped') NULL,
  platform       VARCHAR(32) NULL,
  note           TEXT NULL,
  created_at     DATETIME DEFAULT NOW(),
  updated_at     DATETIME DEFAULT NOW() ON UPDATE NOW(),
  KEY idx_user_game (user_id, game_id),
  KEY idx_user_start (user_id, occurred_start),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
