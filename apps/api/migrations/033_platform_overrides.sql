CREATE TABLE IF NOT EXISTS user_platform_overrides (
  user_id  INT NOT NULL,
  platform VARCHAR(32) NOT NULL,
  name     VARCHAR(64) NULL,
  icon     VARCHAR(10) NULL,
  PRIMARY KEY (user_id, platform),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
