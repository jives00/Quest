CREATE TABLE IF NOT EXISTS games (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  igdb_id              BIGINT UNIQUE NULL,
  match_status         ENUM('matched','provisional','manual') NOT NULL DEFAULT 'provisional',
  title                VARCHAR(500) NOT NULL,
  sort_title           VARCHAR(500) NULL,
  first_release_date   DATE NULL,
  summary              TEXT NULL,
  genres               JSON NULL,
  platforms            JSON NULL,
  cover_path           VARCHAR(500) NULL,
  hltb_main_hours      DECIMAL(6,2) NULL,
  metacritic           TINYINT UNSIGNED NULL,
  metadata_fetched_at  DATETIME NULL,
  created_at           DATETIME DEFAULT NOW(),
  updated_at           DATETIME DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
