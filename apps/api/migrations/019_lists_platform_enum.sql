-- 019_lists_platform_enum.sql
-- Phase 2 follow-up: migration 017 widened the source/platform ENUMs everywhere EXCEPT
-- lists.platform, which stayed ENUM('steam','psn'). So per-platform lists for the new
-- sources (xbox/epic/gog/meta_quest) were created with their platform value silently
-- truncated to '' (MySQL non-strict), making the list appear but its derived membership
-- query — ownership.platform = lists.platform — never match. Widen, then repair the rows.

ALTER TABLE lists
  MODIFY COLUMN platform ENUM('steam','psn','xbox','epic','gog','meta_quest') NULL;

-- Repair any platform-list row whose platform got blanked before the widen. The slug is
-- always 'platform-<platform>', so recover the value from it (chars after 'platform-').
UPDATE lists
   SET platform = SUBSTRING(slug, 10)
 WHERE kind = 'platform'
   AND slug LIKE 'platform-%'
   AND (platform IS NULL OR platform = '');
