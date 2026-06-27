-- Tracks platforms the user has explicitly removed from a game so pollers don't re-add them.
-- recordOwnership checks this table and skips if a suppression row exists.
-- The row is deleted when the user manually re-adds the platform via POST /ownership.
CREATE TABLE IF NOT EXISTS ownership_suppressions (
  user_id    INT NOT NULL,
  game_id    INT NOT NULL,
  platform   ENUM('steam','psn','xbox','epic','gog','meta_quest') NOT NULL,
  created_at DATETIME DEFAULT NOW(),
  PRIMARY KEY (user_id, game_id, platform),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
