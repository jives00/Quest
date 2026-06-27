-- 027_user_platforms.sql
-- User-defined platforms for manually-maintained libraries (no API integration).
-- Built-in platforms remain ENUM-gated in ownership/playtime tables; custom
-- platforms live here and are joined in via custom_ownership.

CREATE TABLE IF NOT EXISTS user_platforms (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  name       VARCHAR(64) NOT NULL,
  slug       VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_user_platform (user_id, slug),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS custom_ownership (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  game_id     INT NOT NULL,
  platform_id INT NOT NULL,
  created_at  DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_custom_ownership (user_id, game_id, platform_id),
  FOREIGN KEY (user_id)     REFERENCES users(id)          ON DELETE CASCADE,
  FOREIGN KEY (game_id)     REFERENCES games(id)          ON DELETE CASCADE,
  FOREIGN KEY (platform_id) REFERENCES user_platforms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
