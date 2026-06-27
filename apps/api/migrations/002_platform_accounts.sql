CREATE TABLE IF NOT EXISTS platform_accounts (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  user_id              INT NOT NULL,
  platform             ENUM('steam','psn') NOT NULL,
  steam_id64           VARCHAR(32) NULL,
  npsso_token          VARCHAR(512) NULL,
  credential_expires_at DATETIME NULL,
  is_public            BOOLEAN NOT NULL DEFAULT TRUE,
  last_synced_at       DATETIME NULL,
  enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  health               ENUM('green','amber','red') NOT NULL DEFAULT 'green',
  last_error           TEXT NULL,
  created_at           DATETIME DEFAULT NOW(),
  updated_at           DATETIME DEFAULT NOW() ON UPDATE NOW(),
  UNIQUE KEY uq_platform_account (user_id, platform),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
