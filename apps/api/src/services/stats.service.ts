import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import { ALL_PLATFORMS, PLATFORM_LABELS, type Platform } from '../platforms';

// Aggregate analytics over the whole library. Two surfaces:
//  - getStats(userId): the comprehensive lifetime dashboard.
//  - getYearStats(userId, year): the year-in-review recap.

export interface PlatformBreakdown {
  platform: string;
  label: string;
  owned: number;
  playMinutes: number;
  achievements: number;
}

export interface GenreBreakdown {
  genre: string;
  playMinutes: number;
  games: number;
}

export interface TopGame {
  gameId: number;
  title: string;
  coverPath: string | null;
  playMinutes: number;
  completionCount: number;
}

export interface CompletionsByYear {
  year: number;
  count: number;
}

export interface YearlyAchievements {
  year: number;
  count: number;
}

export interface RarityAchievement {
  gameId: number;
  title: string;
  coverPath: string | null;
  apiName: string;
  name: string;
  description: string | null;
  icon: string | null;
  globalPct: number;
  unlockedAt: string;
}

export interface PerfectGame {
  gameId: number;
  title: string;
  coverPath: string | null;
  achievementCount: number;
}

export interface HeatmapDay {
  date: string;
  minutes: number;
}

export interface StatsOverview {
  trackedMinutes: number;
  lifetimeMinutes: number;
  sessionCount: number;
  gamesOwned: number;
  gamesPlayed: number;
  achievementsUnlocked: number;
  perfectGames: number;
  needsMatch: number;
}

export interface RecentPlatformPlaytime {
  platform: Platform;
  label: string;
  playMinutes: number;
}

export interface RecentGenrePlaytime {
  genre: string;
  playMinutes: number;
  games: number;
}

export interface Stats {
  overview: StatsOverview;
  statusCounts: Record<string, number>;
  byPlatform: PlatformBreakdown[];
  recentPlatformPlaytime: RecentPlatformPlaytime[];
  byGenre: GenreBreakdown[];
  recentGenrePlaytime: RecentGenrePlaytime[];
  topPlayed: TopGame[];
  heatmap: HeatmapDay[];
  completionsByYear: CompletionsByYear[];
  yearlyAchievements: YearlyAchievements[];
  rarityAchievements: RarityAchievement[];
  perfectGames: PerfectGame[];
}

function asInt(v: unknown): number {
  return Number(v ?? 0);
}

/** games.genres is a JSON column; tolerate array-of-strings or array-of-{name}. */
function genreNames(raw: unknown): string[] {
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map(g => (typeof g === 'string' ? g : (g as { name?: string })?.name))
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

export async function getStats(userId: number, tzOffsetMinutes = 0): Promise<Stats> {
  const pool = getPool();

  // All queries below only depend on userId/tzOffsetMinutes (not on each
  // other's results), so run them concurrently instead of serially — this
  // was ~20 sequential round trips before.
  const [
    [[trackedRow]],
    [[lifetimeRow]],
    [[ownedRow]],
    [[playedRow]],
    [[achRow]],
    [[needsMatchRow]],
    [[perfectRow]],
    [statusRows],
    [ownPlat],
    [playPlat],
    [achPlat],
    [customPlatRows],
    [genreRows],
    [topRows],
    [heatRows],
    [recentPlatRows],
    [recentGenreRows],
    [compYearRows],
    [yearAchRows],
    [rarityRows],
    [perfectGameRows],
  ] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(duration_min),0) AS m, COUNT(*) AS n
         FROM play_sessions WHERE user_id = ?`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(total_minutes),0) AS m FROM playtime_totals WHERE user_id = ?`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT game_id) AS n FROM ownership WHERE user_id = ?`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT game_id) AS n FROM playtime_totals WHERE user_id = ? AND total_minutes > 0`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM user_achievements WHERE user_id = ? AND unlocked_at IS NOT NULL`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT o.game_id) AS n
         FROM ownership o JOIN games g ON g.id = o.game_id
        WHERE o.user_id = ? AND g.match_status = 'provisional'`,
      [userId],
    ),
    // Perfect games: every known achievement for the game unlocked by the user.
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM (
         SELECT a.game_id
           FROM achievements a
           LEFT JOIN user_achievements ua
             ON ua.game_id = a.game_id AND ua.api_name = a.api_name
            AND ua.user_id = ? AND ua.unlocked_at IS NOT NULL
          GROUP BY a.game_id
         HAVING COUNT(a.id) > 0 AND COUNT(a.id) = COUNT(ua.id)
       ) t`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT status, COUNT(*) AS n FROM game_status WHERE user_id = ? GROUP BY status`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT platform, COUNT(DISTINCT game_id) AS n FROM ownership WHERE user_id = ? GROUP BY platform`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT source, COALESCE(SUM(total_minutes),0) AS m FROM playtime_totals WHERE user_id = ? GROUP BY source`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT a.source, COUNT(*) AS n
         FROM user_achievements ua JOIN achievements a
           ON a.game_id = ua.game_id AND a.api_name = ua.api_name
        WHERE ua.user_id = ? AND ua.unlocked_at IS NOT NULL
        GROUP BY a.source`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT up.name, COUNT(DISTINCT co.game_id) AS n
         FROM custom_ownership co
         JOIN user_platforms up ON up.id = co.platform_id
        WHERE co.user_id = ?
        GROUP BY up.id, up.name`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT g.genres AS genres, SUM(pt.total_minutes) AS m
         FROM playtime_totals pt JOIN games g ON g.id = pt.game_id
        WHERE pt.user_id = ? AND pt.total_minutes > 0
        GROUP BY g.id`,
      [userId],
    ),
    // Completions are pre-aggregated to one row per (game, user) BEFORE the join.
    // Joining game_completions directly fans each playtime_totals row out once per
    // completion, and SUM(pt.total_minutes) then counts the same minutes once per
    // completion -- a game completed twice reported double its playtime (Stardew
    // Valley: 485.9h -> 971.8h). COUNT(DISTINCT gc.id) hid it by staying correct
    // next to a SUM that was not. It also corrupted the ranking, since ORDER BY and
    // LIMIT 12 both ran on the inflated value.
    pool.query<RowDataPacket[]>(
      `SELECT g.id AS game_id, g.title, g.cover_path,
              SUM(pt.total_minutes) AS m,
              COALESCE(gc.completions, 0) AS completions
         FROM playtime_totals pt
         JOIN games g ON g.id = pt.game_id
         LEFT JOIN (
           SELECT game_id, user_id, COUNT(*) AS completions
             FROM game_completions
            GROUP BY game_id, user_id
         ) gc ON gc.game_id = g.id AND gc.user_id = pt.user_id
        WHERE pt.user_id = ?
        GROUP BY g.id, gc.completions ORDER BY m DESC LIMIT 12`,
      [userId],
    ),
    // Heatmap (all-time, frontend windows to last 365 days). No date filter
    // here — the frontend calendar grid only renders cells for the past 365
    // days, so old/future records are naturally ignored. This avoids issues
    // with NAS clock drift making NOW()-based filters exclude valid records.
    // Avoid CONVERT_TZ — returns NULL without timezone tables.
    // tzOffsetMinutes is JS getTimezoneOffset(): positive = behind UTC (e.g.
    // CDT = 300). Subtract from UTC to get local time for date bucketing.
    pool.query<RowDataPacket[]>(
      `SELECT DATE(started_at - INTERVAL ? MINUTE) AS d, SUM(duration_min) AS m
         FROM play_sessions
        WHERE user_id = ?
        GROUP BY DATE(started_at - INTERVAL ? MINUTE)
       HAVING d IS NOT NULL
        ORDER BY d`,
      [tzOffsetMinutes, userId, tzOffsetMinutes],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT source, COALESCE(SUM(duration_min), 0) AS m
         FROM play_sessions
        WHERE user_id = ? AND started_at > DATE_SUB(NOW(), INTERVAL 12 MONTH)
        GROUP BY source`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT g.genres AS genres, SUM(ps.duration_min) AS m
         FROM play_sessions ps JOIN games g ON g.id = ps.game_id
        WHERE ps.user_id = ? AND ps.started_at > DATE_SUB(NOW(), INTERVAL 12 MONTH) AND ps.duration_min > 0
        GROUP BY g.id`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT yr, COUNT(DISTINCT game_id) AS cnt
         FROM (
           SELECT YEAR(completed_at) AS yr, game_id FROM game_completions WHERE user_id = ?
           UNION
           SELECT YEAR(occurred_start), game_id FROM play_history WHERE user_id = ? AND status = 'completed' AND occurred_start IS NOT NULL
         ) t
        GROUP BY yr ORDER BY yr ASC`,
      [userId, userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT YEAR(CONVERT_TZ(unlocked_at, '+00:00', 'America/Chicago')) AS yr, COUNT(*) AS cnt
         FROM user_achievements
        WHERE user_id = ? AND unlocked_at IS NOT NULL
        GROUP BY yr ORDER BY yr ASC`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT g.id AS game_id, g.title, g.cover_path,
              a.api_name, a.name, a.description, a.icon, a.global_pct,
              ua.unlocked_at
         FROM user_achievements ua
         JOIN achievements a ON a.game_id = ua.game_id AND a.api_name = ua.api_name
         JOIN games g ON g.id = ua.game_id
        WHERE ua.user_id = ? AND ua.unlocked_at IS NOT NULL AND a.global_pct IS NOT NULL
        ORDER BY a.global_pct ASC
        LIMIT 14`,
      [userId],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT g.id AS game_id, g.title, g.cover_path, COUNT(a.id) AS ach_count
         FROM achievements a
         LEFT JOIN user_achievements ua
           ON ua.game_id = a.game_id AND ua.api_name = a.api_name
          AND ua.user_id = ? AND ua.unlocked_at IS NOT NULL
         JOIN games g ON g.id = a.game_id
        GROUP BY a.game_id
       HAVING COUNT(a.id) > 0 AND COUNT(a.id) = COUNT(ua.id)
        ORDER BY ach_count DESC`,
      [userId],
    ),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const r of statusRows) statusCounts[r.status as string] = asInt(r.n);

  const ownMap = new Map(ownPlat.map(r => [r.platform as string, asInt(r.n)]));
  const playMap = new Map(playPlat.map(r => [r.source as string, asInt(r.m)]));
  const achMap = new Map(achPlat.map(r => [r.source as string, asInt(r.n)]));
  const byPlatform: PlatformBreakdown[] = ALL_PLATFORMS
    .map(p => ({
      platform: p,
      label: PLATFORM_LABELS[p],
      owned: ownMap.get(p) ?? 0,
      playMinutes: playMap.get(p) ?? 0,
      achievements: achMap.get(p) ?? 0,
    }))
    .filter(p => p.owned || p.playMinutes || p.achievements);

  // Custom platforms: ownership count only (no playtime/achievements for custom platforms)
  for (const r of customPlatRows) {
    const n = asInt(r.n);
    if (n > 0) byPlatform.push({ platform: `custom:${r.name as string}`, label: r.name as string, owned: n, playMinutes: 0, achievements: 0 });
  }

  // ---- Per-genre (expanded in JS from the games.genres JSON) --------------
  const genreAgg = new Map<string, { playMinutes: number; games: number }>();
  for (const r of genreRows) {
    const minutes = asInt(r.m);
    for (const name of genreNames(r.genres)) {
      const cur = genreAgg.get(name) ?? { playMinutes: 0, games: 0 };
      cur.playMinutes += minutes;
      cur.games += 1;
      genreAgg.set(name, cur);
    }
  }
  const byGenre: GenreBreakdown[] = [...genreAgg.entries()]
    .map(([genre, v]) => ({ genre, ...v }))
    .sort((a, b) => b.playMinutes - a.playMinutes)
    .slice(0, 12);

  // ---- Top played --------------------------------------------------------
  const topPlayed: TopGame[] = topRows.map(r => ({
    gameId: r.game_id as number,
    title: r.title as string,
    coverPath: r.cover_path as string | null,
    playMinutes: asInt(r.m),
    completionCount: asInt(r.completions),
  }));

  // ---- Heatmap (all-time, frontend windows to last 365 days) -------------
  const heatmap: HeatmapDay[] = heatRows.map(r => {
    const raw = r.d;
    const date = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw).slice(0, 10);
    return { date, minutes: asInt(r.m) };
  });

  // ---- Recent platform playtime (last 12 months, from sessions) ----------
  const recentPlatMap = new Map(recentPlatRows.map(r => [r.source as string, asInt(r.m)]));
  const recentPlatformPlaytime: RecentPlatformPlaytime[] = ALL_PLATFORMS
    .map(p => ({ platform: p, label: PLATFORM_LABELS[p], playMinutes: recentPlatMap.get(p) ?? 0 }))
    .filter(p => p.playMinutes > 0)
    .sort((a, b) => b.playMinutes - a.playMinutes);

  // ---- Recent genre playtime (last 12 months, from sessions) -------------
  const recentGenreAgg = new Map<string, { playMinutes: number; games: number }>();
  for (const r of recentGenreRows) {
    const minutes = asInt(r.m);
    for (const name of genreNames(r.genres)) {
      const cur = recentGenreAgg.get(name) ?? { playMinutes: 0, games: 0 };
      cur.playMinutes += minutes;
      cur.games += 1;
      recentGenreAgg.set(name, cur);
    }
  }
  const recentGenrePlaytime: RecentGenrePlaytime[] = [...recentGenreAgg.entries()]
    .map(([genre, v]) => ({ genre, ...v }))
    .sort((a, b) => b.playMinutes - a.playMinutes)
    .slice(0, 12);

  // ---- Completions by year -----------------------------------------------
  const completionsByYear: CompletionsByYear[] = compYearRows.map(r => ({
    year: Number(r.yr),
    count: asInt(r.cnt),
  }));

  // ---- Yearly achievements -----------------------------------------------
  const yearlyAchievements: YearlyAchievements[] = yearAchRows.map(r => ({
    year: Number(r.yr),
    count: asInt(r.cnt),
  }));

  // ---- Rarity achievements (top 10 rarest unlocked) ----------------------
  const rarityAchievements: RarityAchievement[] = rarityRows.map(r => ({
    gameId: r.game_id as number,
    title: r.title as string,
    coverPath: r.cover_path as string | null,
    apiName: r.api_name as string,
    name: r.name as string,
    description: r.description as string | null,
    icon: r.icon as string | null,
    globalPct: Number(r.global_pct),
    unlockedAt: r.unlocked_at as string,
  }));

  // ---- Perfect games (all achievements unlocked) -------------------------
  const perfectGames: PerfectGame[] = perfectGameRows.map(r => ({
    gameId: r.game_id as number,
    title: r.title as string,
    coverPath: r.cover_path as string | null,
    achievementCount: asInt(r.ach_count),
  }));

  return {
    overview: {
      trackedMinutes: asInt(trackedRow.m),
      lifetimeMinutes: asInt(lifetimeRow.m),
      sessionCount: asInt(trackedRow.n),
      gamesOwned: asInt(ownedRow.n),
      gamesPlayed: asInt(playedRow.n),
      achievementsUnlocked: asInt(achRow.n),
      perfectGames: asInt(perfectRow.n),
      needsMatch: asInt(needsMatchRow.n),
    },
    statusCounts,
    byPlatform,
    recentPlatformPlaytime,
    byGenre,
    recentGenrePlaytime,
    topPlayed,
    heatmap,
    completionsByYear,
    yearlyAchievements,
    rarityAchievements,
    perfectGames,
  };
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export type ActivityEventType = 'session' | 'achievement' | 'completion' | 'status' | 'wishlist' | 'backlog' | 'ownership';

export interface ActivityEvent {
  type: ActivityEventType;
  at: string;
  gameId: number;
  gameTitle: string;
  coverPath: string | null;
  detail: string;
  extra?: string | null;
}

// Shared by getRecentActivity (dashboard widget) and getActivityPage (full history).
// Seven UNION branches, each needing its own `user_id = ?` — callers must repeat
// userId seven times in the param array before any of their own params.
const ACTIVITY_UNION_SQL = `
     SELECT 'session' AS type,
            MAX(CONVERT_TZ(ps.started_at, '+00:00', 'America/Chicago')) AS at,
            g.id AS game_id, g.title, g.cover_path,
            CAST(SUM(ps.duration_min) AS CHAR) AS detail,
            NULL AS extra
       FROM play_sessions ps JOIN games g ON g.id = ps.game_id
      WHERE ps.user_id = ? AND ps.duration_min > 0
      GROUP BY g.id, DATE(CONVERT_TZ(ps.started_at, '+00:00', 'America/Chicago'))

     UNION ALL

     SELECT 'achievement',
            CONVERT_TZ(ua.unlocked_at, '+00:00', 'America/Chicago'),
            g.id, g.title, g.cover_path,
            CASE WHEN a.source = 'psn' THEN CONCAT('Trophy unlocked: ', a.name) ELSE CONCAT('Achievement unlocked: ', a.name) END,
            a.icon
       FROM user_achievements ua
       JOIN achievements a ON a.game_id = ua.game_id AND a.api_name = ua.api_name
       JOIN games g ON g.id = ua.game_id
      WHERE ua.user_id = ? AND ua.unlocked_at IS NOT NULL

     UNION ALL

     SELECT 'completion',
            CONVERT_TZ(gc.completed_at, '+00:00', 'America/Chicago'),
            g.id, g.title, g.cover_path,
            'Completed' AS detail,
            NULL
       FROM game_completions gc JOIN games g ON g.id = gc.game_id
      WHERE gc.user_id = ?

     UNION ALL

     SELECT 'status',
            CONVERT_TZ(gs.finished_at, '+00:00', 'America/Chicago'),
            g.id, g.title, g.cover_path,
            CONCAT('Marked as ', gs.status),
            gs.status
       FROM game_status gs JOIN games g ON g.id = gs.game_id
      WHERE gs.user_id = ? AND gs.finished_at IS NOT NULL

     UNION ALL

     SELECT 'wishlist',
            CONVERT_TZ(li.added_at, '+00:00', 'America/Chicago'),
            g.id, g.title, g.cover_path,
            'Added to Wishlist',
            NULL
       FROM list_items li
       JOIN lists l ON l.id = li.list_id
       JOIN games g ON g.id = li.game_id
      WHERE l.user_id = ? AND l.system_key = 'wishlist'

     UNION ALL

     SELECT 'backlog',
            CONVERT_TZ(li.added_at, '+00:00', 'America/Chicago'),
            g.id, g.title, g.cover_path,
            'Added to Backlog',
            NULL
       FROM list_items li
       JOIN lists l ON l.id = li.list_id
       JOIN games g ON g.id = li.game_id
      WHERE l.user_id = ? AND l.system_key = 'backlog'

     UNION ALL

     SELECT 'ownership',
            CONVERT_TZ(o.acquired_at, '+00:00', 'America/Chicago'),
            g.id, g.title, g.cover_path,
            CONCAT('Added to ', o.platform, ' library'),
            o.platform
       FROM ownership o
       JOIN games g ON g.id = o.game_id
      WHERE o.user_id = ? AND o.acquired_at IS NOT NULL
`;

function activityRowsToEvents(rows: RowDataPacket[]): ActivityEvent[] {
  return rows.map(r => ({
    type: r.type as ActivityEventType,
    at: r.at as string,
    gameId: r.game_id as number,
    gameTitle: r.title as string,
    coverPath: r.cover_path as string | null,
    detail: r.detail as string,
    extra: r.extra as string | null,
  }));
}

export async function getRecentActivity(userId: number, limit = 10): Promise<ActivityEvent[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `${ACTIVITY_UNION_SQL} ORDER BY at DESC LIMIT ?`,
    [userId, userId, userId, userId, userId, userId, userId, limit],
  );
  return activityRowsToEvents(rows);
}

export interface ActivityPage {
  events: ActivityEvent[];
  total: number;
}

export async function getActivityPage(
  userId: number,
  opts: { type?: ActivityEventType; gameId?: number; page?: number; limit?: number },
): Promise<ActivityPage> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 30));
  const offset = (page - 1) * limit;

  const filters: string[] = [];
  const filterParams: (string | number)[] = [];
  if (opts.type) {
    filters.push('type = ?');
    filterParams.push(opts.type);
  }
  if (opts.gameId) {
    filters.push('game_id = ?');
    filterParams.push(opts.gameId);
  }
  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

  const userParams = [userId, userId, userId, userId, userId, userId, userId];

  const [[{ total }]] = await getPool().query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${ACTIVITY_UNION_SQL}) t ${whereClause}`,
    [...userParams, ...filterParams],
  );

  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT * FROM (${ACTIVITY_UNION_SQL}) t ${whereClause} ORDER BY at DESC LIMIT ? OFFSET ?`,
    [...userParams, ...filterParams, limit, offset],
  );

  return { events: activityRowsToEvents(rows), total: Number(total) };
}

// ---------------------------------------------------------------------------
// Year-in-review
// ---------------------------------------------------------------------------

export interface YearStats {
  year: number;
  playMinutes: number;
  sessionCount: number;
  gamesPlayed: number;
  gamesFinished: number;
  achievementsUnlocked: number;
  gamesAcquired: number;
  topPlayed: TopGame[];
  finishedTitles: { gameId: number; title: string; status: string; at: string; playMinutes: number }[];
}

/** Distinct years that have any activity, newest first (drives the year picker). */
export async function getAvailableYears(userId: number): Promise<number[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT y FROM (
       SELECT YEAR(CONVERT_TZ(started_at, '+00:00', 'America/Chicago')) y FROM play_sessions WHERE user_id = ?
       UNION SELECT YEAR(CONVERT_TZ(unlocked_at, '+00:00', 'America/Chicago')) FROM user_achievements WHERE user_id = ? AND unlocked_at IS NOT NULL
       UNION SELECT YEAR(occurred_start) FROM play_history WHERE user_id = ? AND occurred_start IS NOT NULL
       UNION SELECT YEAR(finished_at) FROM game_status WHERE user_id = ? AND finished_at IS NOT NULL
       UNION SELECT YEAR(completed_at) FROM game_completions WHERE user_id = ?
       UNION SELECT YEAR(acquired_at) FROM ownership WHERE user_id = ? AND acquired_at IS NOT NULL
     ) t WHERE y IS NOT NULL ORDER BY y DESC`,
    [userId, userId, userId, userId, userId, userId],
  );
  return rows.map(r => Number(r.y));
}

export async function getYearStats(userId: number, year: number): Promise<YearStats> {
  const pool = getPool();

  // Years to charge undated playtime to. Completions outrank sessions: a
  // completion says the game was actually being played that year, whereas a
  // lone session can be a sync artifact or a single launch. Weighting those
  // equally let one 2026 launch pull half of a game's lifetime hours into 2026
  // for a game finished back in 2024. Session years therefore only count for
  // games with no completion records at all -- those have nothing better.
  //
  // Sessions are still counted in full on their own; this only decides where
  // the *untracked remainder* lands.
  const NO_COMPLETION_RECORDS = `
    NOT EXISTS (
      SELECT 1 FROM game_completions gc
       WHERE gc.user_id = ? AND gc.game_id = ps.game_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM play_history ph
       WHERE ph.user_id = ? AND ph.game_id = ps.game_id
         AND ph.status = 'completed' AND ph.occurred_start IS NOT NULL
    )`;

  const EVIDENCE_YEARS = `
    SELECT game_id, COUNT(DISTINCT yr) AS years FROM (
      SELECT game_id, YEAR(completed_at) AS yr FROM game_completions WHERE user_id = ?
      UNION
      SELECT game_id, YEAR(occurred_start) FROM play_history
       WHERE user_id = ? AND status = 'completed' AND occurred_start IS NOT NULL
      UNION
      SELECT ps.game_id, YEAR(CONVERT_TZ(ps.started_at, '+00:00', 'America/Chicago'))
        FROM play_sessions ps
       WHERE ps.user_id = ? AND ${NO_COMPLETION_RECORDS}
    ) u GROUP BY game_id`;

  // Whether THIS year is one of those years, for the game in the outer query.
  const IS_EVIDENCE_YEAR = `
    EXISTS (
      SELECT 1 FROM game_completions
       WHERE user_id = ? AND game_id = pt.game_id AND YEAR(completed_at) = ?
    )
    OR EXISTS (
      SELECT 1 FROM play_history
       WHERE user_id = ? AND game_id = pt.game_id
         AND status = 'completed' AND occurred_start IS NOT NULL
         AND YEAR(occurred_start) = ?
    )
    OR EXISTS (
      SELECT 1 FROM play_sessions ps
       WHERE ps.user_id = ? AND ps.game_id = pt.game_id
         AND YEAR(CONVERT_TZ(ps.started_at, '+00:00', 'America/Chicago')) = ?
         AND ${NO_COMPLETION_RECORDS}
    )`;

  const [
    [[playRow]],
    [[achRow]],
    [[acqRow]],
    [hltbRows],
    [topRows],
    [finishedRows],
    [gapRows],
  ] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(duration_min),0) AS m, COUNT(*) AS n,
              COUNT(DISTINCT game_id) AS g
         FROM play_sessions WHERE user_id = ? AND YEAR(CONVERT_TZ(started_at, '+00:00', 'America/Chicago')) = ?`,
      [userId, year],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM user_achievements
        WHERE user_id = ? AND YEAR(CONVERT_TZ(unlocked_at, '+00:00', 'America/Chicago')) = ?`,
      [userId, year],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT COUNT(DISTINCT game_id) AS n FROM ownership
        WHERE user_id = ? AND YEAR(acquired_at) = ?`,
      [userId, year],
    ),
    // Supplemental: lifetime playtime for games completed this year that Quest
    // never tracked a session for. Not filtered by source -- a Steam/PSN/Xbox
    // import writes a lifetime total without creating per-session rows, so
    // restricting to hltb/manual dropped those games out of the year entirely.
    //
    // The NOT EXISTS covers sessions in ANY year, not just this one. A lifetime
    // total has no per-year breakdown, so a game played across several years
    // would otherwise have its whole total charged to each year it was
    // completed in. Once Quest has tracked even one session, the sessions are
    // the better record and the lifetime total is dropped entirely.
    //
    // playtime_totals is keyed by (user_id, game_id, source), so one game can
    // hold several rows -- a PSN import and an HLTB estimate, say. The `best`
    // join keeps only the highest-confidence tier per game (manual > platform >
    // hltb estimate) so the game contributes one row instead of one per source,
    // and so an HLTB guess never gets added on top of real tracked playtime.
    // Rows are summed within the winning tier, which only matters for a game
    // genuinely played on two platforms.
    //
    // The `yc` join divides the total by how many distinct years the game was
    // completed in. A lifetime total has no per-year breakdown, so a game
    // finished in 2023 and again in 2026 would otherwise report its full total
    // in both -- inventing hours that were only ever played once. An even split
    // is still an estimate, but it conserves the lifetime total across the
    // history instead of inflating it. This only ever affects pre-Quest
    // playtime: once a game has a tracked session the NOT EXISTS below drops
    // its lifetime total entirely, and real sessions are already dated.
    pool.query<RowDataPacket[]>(
      `SELECT pt.game_id, ROUND(SUM(pt.total_minutes) / yc.years) AS m, g.title, g.cover_path
         FROM playtime_totals pt
         JOIN games g ON g.id = pt.game_id
         JOIN (
           SELECT game_id,
                  MIN(CASE source WHEN 'manual' THEN 0 WHEN 'hltb' THEN 2 ELSE 1 END) AS tier
             FROM playtime_totals
            WHERE user_id = ?
            GROUP BY game_id
         ) best ON best.game_id = pt.game_id
               AND (CASE pt.source WHEN 'manual' THEN 0 WHEN 'hltb' THEN 2 ELSE 1 END) = best.tier
         JOIN (
           SELECT game_id, COUNT(DISTINCT yr) AS years FROM (
             SELECT game_id, YEAR(completed_at) AS yr
               FROM game_completions WHERE user_id = ?
             UNION
             SELECT game_id, YEAR(occurred_start)
               FROM play_history
              WHERE user_id = ? AND status = 'completed' AND occurred_start IS NOT NULL
           ) u GROUP BY game_id
         ) yc ON yc.game_id = pt.game_id
        WHERE pt.user_id = ?
          AND (
            EXISTS (
              SELECT 1 FROM game_completions
               WHERE user_id = ? AND game_id = pt.game_id AND YEAR(completed_at) = ?
            )
            OR EXISTS (
              SELECT 1 FROM play_history
               WHERE user_id = ? AND game_id = pt.game_id
                 AND status = 'completed' AND occurred_start IS NOT NULL
                 AND YEAR(occurred_start) = ?
            )
          )
          AND NOT EXISTS (
            SELECT 1 FROM play_sessions ps
             WHERE ps.user_id = ? AND ps.game_id = pt.game_id
          )
        GROUP BY pt.game_id, g.title, g.cover_path, yc.years`,
      [userId, userId, userId, userId, userId, year, userId, year, userId],
    ),
    pool.query<RowDataPacket[]>(
      // No LIMIT: this doubles as the per-game minutes lookup for the finished
      // list, so a game finished this year but outside the top 12 by playtime
      // still needs a row. topPlayed slices to 12 after merging anyway.
      `SELECT g.id AS game_id, g.title, g.cover_path, SUM(ps.duration_min) AS m
         FROM play_sessions ps JOIN games g ON g.id = ps.game_id
        WHERE ps.user_id = ? AND YEAR(CONVERT_TZ(ps.started_at, '+00:00', 'America/Chicago')) = ?
        GROUP BY g.id ORDER BY m DESC`,
      [userId, year],
    ),
    // Finished = game_completions entries that year (source of truth)
    // + manual play_history completed entries that year
    pool.query<RowDataPacket[]>(
      `SELECT g.id AS game_id, g.title, 'completed' AS status, gc.completed_at AS at
         FROM game_completions gc JOIN games g ON g.id = gc.game_id
        WHERE gc.user_id = ? AND YEAR(gc.completed_at) = ?
       UNION
       SELECT g.id, g.title, ph.status, ph.occurred_start
         FROM play_history ph JOIN games g ON g.id = ph.game_id
        WHERE ph.user_id = ? AND YEAR(ph.occurred_start) = ?
          AND ph.status = 'completed'
        ORDER BY at DESC`,
      [userId, year, userId, year],
    ),
    // A platform total is cumulative from purchase, but Quest only has sessions
    // from when it started syncing -- so a game can show 72h on Steam against
    // 49h of tracked sessions. That remainder is real playtime with no date.
    // It gets spread evenly over the years the game shows evidence of being
    // played, so a game finished in 2018 and replayed in 2026 doesn't dump its
    // whole pre-Quest history onto 2026.
    //
    // This is the mirror of the supplemental query above: that one handles
    // games with no sessions at all, this one games that have some. The
    // INNER JOIN on tracked totals keeps the two sets disjoint.
    pool.query<RowDataPacket[]>(
      `SELECT pt.game_id, g.title, g.cover_path,
              ROUND(GREATEST(SUM(pt.total_minutes) - tr.tracked, 0) / ev.years) AS m
         FROM playtime_totals pt
         JOIN games g ON g.id = pt.game_id
         JOIN (
           SELECT game_id,
                  MIN(CASE source WHEN 'manual' THEN 0 WHEN 'hltb' THEN 2 ELSE 1 END) AS tier
             FROM playtime_totals
            WHERE user_id = ?
            GROUP BY game_id
         ) best ON best.game_id = pt.game_id
               AND (CASE pt.source WHEN 'manual' THEN 0 WHEN 'hltb' THEN 2 ELSE 1 END) = best.tier
         JOIN (
           SELECT game_id, SUM(duration_min) AS tracked
             FROM play_sessions WHERE user_id = ? GROUP BY game_id
         ) tr ON tr.game_id = pt.game_id
         JOIN (${EVIDENCE_YEARS}) ev ON ev.game_id = pt.game_id
        WHERE pt.user_id = ?
          AND (${IS_EVIDENCE_YEAR})
        GROUP BY pt.game_id, g.title, g.cover_path, tr.tracked, ev.years
       HAVING m > 0`,
      [
        userId,                                  // best-tier subquery
        userId,                                  // tracked-session totals
        userId, userId, userId, userId, userId,  // EVIDENCE_YEARS
        userId,                                  // pt.user_id
        userId, year,                            // IS_EVIDENCE_YEAR: completions
        userId, year,                            //   play_history
        userId, year, userId, userId,            //   sessions + NO_COMPLETION_RECORDS
      ],
    ),
  ]);
  const hltbExtraMinutes = hltbRows.reduce((s: number, r: RowDataPacket) => s + asInt(r.m), 0);

  // This year's share of platform playtime that no session accounts for.
  const gapMinutes = new Map<number, number>();
  for (const r of gapRows as RowDataPacket[]) {
    gapMinutes.set(r.game_id as number, asInt(r.m));
  }
  const gapExtraMinutes = [...gapMinutes.values()].reduce((s, m) => s + m, 0);

  const sessionTopGames: TopGame[] = topRows.map(r => ({
    gameId: r.game_id as number,
    title: r.title as string,
    coverPath: r.cover_path as string | null,
    playMinutes: asInt(r.m) + (gapMinutes.get(r.game_id as number) ?? 0),
    completionCount: 0,
  }));

  // A game can earn a gap share in a year it has no sessions -- completed in
  // 2018, replayed with tracking in 2026 -- so 2018 needs a row of its own.
  const sessionGameIds = new Set(topRows.map(r => r.game_id as number));
  const gapOnlyGames: TopGame[] = (gapRows as RowDataPacket[])
    .filter(r => !sessionGameIds.has(r.game_id as number))
    .map(r => ({
      gameId: r.game_id as number,
      title: r.title as string,
      coverPath: r.cover_path as string | null,
      playMinutes: asInt(r.m),
      completionCount: 0,
    }));

  // Merge session top games with hltb/manual games (already excluded from sessions above)
  const hltbTopGames: TopGame[] = (hltbRows as RowDataPacket[]).map(r => ({
    gameId: r.game_id as number,
    title: r.title as string,
    coverPath: r.cover_path as string | null,
    playMinutes: asInt(r.m),
    completionCount: 0,
  }));
  // 18 fills three rows of the six-column grid the year page renders.
  const topPlayed: TopGame[] = [...sessionTopGames, ...hltbTopGames, ...gapOnlyGames]
    .sort((a, b) => b.playMinutes - a.playMinutes)
    .slice(0, 18);

  const hltbExtraGames = hltbRows.length;

  // Same year-attributed minutes topPlayed ranks on, keyed by game so the
  // finished list can show a per-game figure. The sources are disjoint by
  // construction -- the supplemental query takes games with no sessions, the
  // gap query games with some, and gapOnlyGames excludes anything already in
  // sessionTopGames -- so a game appears in exactly one of them.
  const yearMinutesByGame = new Map<number, number>();
  for (const g of [...sessionTopGames, ...hltbTopGames, ...gapOnlyGames]) {
    yearMinutesByGame.set(g.gameId, (yearMinutesByGame.get(g.gameId) ?? 0) + g.playMinutes);
  }

  const finishedTitles = finishedRows.map(r => ({
    gameId: r.game_id as number,
    title: r.title as string,
    status: r.status as string,
    at: r.at as string,
    playMinutes: yearMinutesByGame.get(r.game_id as number) ?? 0,
  }));

  return {
    year,
    playMinutes: asInt(playRow.m) + hltbExtraMinutes + gapExtraMinutes,
    sessionCount: asInt(playRow.n),
    gamesPlayed: asInt(playRow.g) + hltbExtraGames + gapOnlyGames.length,
    gamesFinished: finishedTitles.length,
    achievementsUnlocked: asInt(achRow.n),
    gamesAcquired: asInt(acqRow.n),
    topPlayed,
    finishedTitles,
  };
}
