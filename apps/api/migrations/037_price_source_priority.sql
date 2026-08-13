-- 037_price_source_priority.sql
-- Which storefront a wishlist price is quoted from.
--
-- user_price_priority holds the global fallback order (lower sort_order wins).
-- A user with no rows falls back to DEFAULT_PRICE_PRIORITY in price-sources.ts,
-- so this table stays empty until the order is actually customized.
--
-- game_price_source_overrides pins a single source for one game, beating the
-- global order — e.g. a cross-platform game the user intends to buy on PS5.

CREATE TABLE IF NOT EXISTS user_price_priority (
  user_id    INT NOT NULL,
  source     VARCHAR(16) NOT NULL,
  sort_order INT NOT NULL,
  PRIMARY KEY (user_id, source),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_price_source_overrides (
  user_id    INT NOT NULL,
  game_id    INT NOT NULL,
  source     VARCHAR(16) NOT NULL,
  created_at DATETIME DEFAULT NOW(),
  PRIMARY KEY (user_id, game_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
