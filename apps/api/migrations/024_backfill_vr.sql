-- Seed the VR system list for all existing users (idempotent via INSERT IGNORE).
INSERT IGNORE INTO lists (user_id, slug, name, kind, system_key, sort_order)
SELECT id, 'vr', 'VR', 'system', 'vr', 3 FROM users;

-- Backfill vr_supported from the IGDB platform names already stored in games.platforms.
-- Only touches rows where the user has not manually set vr_manual.
UPDATE games SET vr_supported = 1
WHERE vr_manual = 0
  AND (
    JSON_SEARCH(platforms, 'one', 'SteamVR')               IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'PlayStation VR')         IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'PlayStation VR2')        IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Oculus Quest')           IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Oculus Rift')            IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Oculus Go')              IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Meta Quest 2')           IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Meta Quest 3')           IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'HTC Vive')               IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Windows Mixed Reality')  IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Valve Index')            IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Gear VR')                IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Google Cardboard')       IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Daydream')               IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Pico')                   IS NOT NULL
  );
