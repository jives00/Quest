/**
 * Game status and system lists -- shared so the five statuses are defined once
 * instead of being re-declared in `apps/web/lib/api.ts` and
 * `apps/mobile/src/lib/api.ts`, where they used to drift.
 */

/**
 * Where a game sits, right now. Mutually exclusive, and every one of them is
 * an assertion -- there is no default. An owned game you have never formed an
 * opinion about simply has no status row at all.
 */
export type GameStatus =
  /** Don't own it. */
  | 'wishlist'
  /** Own it, queued to play. Where a platform sync files anything new. */
  | 'backlog'
  /** In it now. */
  | 'playing'
  /** Done with it: finished, or dropped partway. */
  | 'completed'
  /** Own it, decided against playing it. A choice, never a default. */
  | 'skipped';

/** Display order: the arc of a game through the library, with the opt-out last. */
export const GAME_STATUSES: readonly GameStatus[] = [
  'wishlist',
  'backlog',
  'playing',
  'completed',
  'skipped',
] as const;

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  wishlist: 'Wishlist',
  backlog: 'Backlog',
  playing: 'Playing',
  completed: 'Completed',
  skipped: 'Skipped',
};

/**
 * What a platform sync assigns to a game it has never seen before. Buying
 * something is treated as intent to play it; moving it to Skipped is the
 * deliberate act, not the other way round.
 */
export const DEFAULT_SYNCED_STATUS: GameStatus = 'backlog';

/**
 * Retired values older clients may still send. `other` was split into Endless
 * and Hidden; `unplayed` was the old silent default and is now `skipped`.
 * The API coerces rather than rejecting, so an older APK keeps working --
 * remove once every client is on the new build.
 */
export const LEGACY_STATUS_ALIASES: Record<string, GameStatus> = {
  other: 'completed',
  unplayed: 'skipped',
};

export function isGameStatus(value: unknown): value is GameStatus {
  return typeof value === 'string' && (GAME_STATUSES as readonly string[]).includes(value);
}

/** Undeletable lists Quest seeds itself. Classification only -- never status. */
export type SystemKey =
  /** Favourites shelf. Queue from it; membership survives the queueing. */
  | 'replay'
  /** No finish line. Excluded from completion-rate stats. */
  | 'endless'
  /** Derived from ownership, not stored as list_items. */
  | 'vr';

/** How a status change came about, for the activity feed. */
export type StatusChangeSource = 'manual' | 'ownership_sync' | 'playtime';
