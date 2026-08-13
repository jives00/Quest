-- 038_game_prices_cache.sql
-- Read-through cache for storefront prices.
--
-- Keyed by price SOURCE, not platform: Steam/Epic/GOG all resolve to 'pc' and
-- share one upstream lookup, so keying by platform would store the same ITAD
-- response three times.
--
-- A row's existence means "we asked the upstream and this is what it said".
-- NULL price with a present row therefore means "listed nowhere right now",
-- which is different from having no row at all (never asked). That distinction
-- is what keeps a failed lookup from being cached as a real "no deals" answer.

CREATE TABLE IF NOT EXISTS game_prices (
  game_id    INT NOT NULL,
  source     VARCHAR(16) NOT NULL,
  country    VARCHAR(8) NOT NULL DEFAULT 'US',
  price      DECIMAL(10,2) NULL,
  regular    DECIMAL(10,2) NULL,
  cut        INT NULL,
  shop       VARCHAR(128) NULL,
  url        TEXT NULL,
  lowest     DECIMAL(10,2) NULL,
  fetched_at DATETIME NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game_id, source, country),
  KEY idx_game_prices_fetched (fetched_at),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
