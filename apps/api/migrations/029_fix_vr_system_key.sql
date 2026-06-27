-- Widen system_key ENUM to include 'vr' (was missing, causing the VR list to malfunction).
ALTER TABLE lists
  MODIFY COLUMN system_key ENUM('backlog','wishlist','replay','vr') NULL;

-- Patch any rows where 'vr' was stored as '' by a non-strict MySQL instance.
UPDATE lists SET system_key = 'vr'
WHERE slug = 'vr' AND kind = 'system' AND (system_key = '' OR system_key IS NULL);

-- Ensure the VR list row exists for all users (idempotent via INSERT IGNORE).
-- Covers users whose row was rejected entirely by a strict MySQL instance in migration 024.
INSERT IGNORE INTO lists (user_id, slug, name, kind, system_key, sort_order)
SELECT id, 'vr', 'VR', 'system', 'vr', 3 FROM users;
