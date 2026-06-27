-- Backfill vr_supported for platform names missing from the original 024 backfill:
-- "Oculus VR" (IGDB platform 162, the generic Oculus/Meta brand) and Meta Quest variants.
-- Only touches rows where vr_manual = 0 (no user override).
UPDATE games SET vr_supported = 1
WHERE vr_manual = 0
  AND vr_supported = 0
  AND (
    JSON_SEARCH(platforms, 'one', 'Oculus VR')       IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Meta Quest')       IS NOT NULL OR
    JSON_SEARCH(platforms, 'one', 'Meta Quest Pro')   IS NOT NULL
  );
