CREATE TABLE IF NOT EXISTS lists (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  slug        VARCHAR(255) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  kind        ENUM('system','platform','custom') NOT NULL DEFAULT 'custom',
  system_key  ENUM('backlog','wishlist','replay') NULL,
  platform    ENUM('steam','psn') NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME DEFAULT NOW(),
  updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW(),
  UNIQUE KEY uq_list_slug (user_id, slug),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS list_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  list_id    INT NOT NULL,
  game_id    INT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  added_at   DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_list_item (list_id, game_id),
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
