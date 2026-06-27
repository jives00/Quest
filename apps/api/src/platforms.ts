// Canonical platform/source definitions shared across services. Phase 2 widened
// the Phase-1 ('steam' | 'psn') unions to the full multi-platform set; keep every
// per-table ENUM (migration 017) in sync with `Platform` below.

/** Every platform a game can be owned on / tracked from. Matches the widened
 *  ownership.platform / playtime_totals.source / play_sessions.source / now_playing.source. */
export type Platform = 'steam' | 'psn' | 'xbox' | 'epic' | 'gog' | 'meta_quest';

/** Platforms with a live polling integration (cumulative playtime / presence /
 *  achievements). Epic/GOG/Quest are import-only and never poll. */
export type PollSource = 'steam' | 'psn' | 'xbox';

/** Platforms populated by a one-shot library import, then maintained by hand. */
export type ImportSource = 'epic' | 'gog' | 'meta_quest';

export const ALL_PLATFORMS: Platform[] = ['steam', 'psn', 'xbox', 'epic', 'gog', 'meta_quest'];
export const IMPORT_SOURCES: ImportSource[] = ['epic', 'gog', 'meta_quest'];

/** Display name for each platform (used for the auto-derived per-platform lists). */
export const PLATFORM_LABELS: Record<Platform, string> = {
  steam: 'Windows/Steam',
  psn: 'PlayStation',
  xbox: 'Xbox / Game Pass',
  epic: 'Epic Games',
  gog: 'GOG',
  meta_quest: 'Meta Quest',
};

/** IGDB platform-id hint passed to the matcher so platform titles prefer the right
 *  edition. PC stores (Steam/Epic/GOG) all map to PC = 6; consoles/VR differ. */
export const IGDB_PLATFORM_HINT: Record<Platform, number | undefined> = {
  steam: 6, // PC (Windows)
  epic: 6,
  gog: 6,
  psn: 167, // PS5 (PS4 = 48; matcher still resolves either)
  xbox: 169, // Xbox Series X|S (Xbox One = 49)
  meta_quest: 162, // Oculus VR (Quest 2 = 386, Quest 3 = 471)
};

/** The external_game_ids.source value used to map each platform's native id. */
export const PLATFORM_EXTERNAL_SOURCE: Record<Platform, string> = {
  steam: 'steam_appid',
  psn: 'psn_concept',
  xbox: 'xbox',
  epic: 'epic',
  gog: 'gog',
  meta_quest: 'meta_quest',
};
