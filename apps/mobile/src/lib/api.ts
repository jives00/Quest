import { resolveApiBase, resetApiBase } from "./apiBase";

// ─── Domain types (re-exported from web lib/api.ts shapes) ────────────────────

export type Platform = "steam" | "psn" | "xbox" | "epic" | "gog" | "meta_quest";
export type ImportSource = "epic" | "gog" | "meta_quest";
export type GameStatus = "unplayed" | "playing" | "completed" | "other";
export type MatchStatus = "matched" | "provisional" | "manual";
export type ListKind = "system" | "platform" | "custom";
export type SystemKey = "backlog" | "wishlist" | "replay" | "vr";
export type DiscoverCategory =
  | "trending"
  | "new_releases"
  | "anticipated"
  | "top_rated"
  | "steam_top_sellers"
  | "by_genre";

export const PLATFORM_LABELS: Record<Platform, string> = {
  steam: "Windows/Steam",
  psn: "PlayStation",
  xbox: "Xbox / Game Pass",
  epic: "Epic Games",
  gog: "GOG",
  meta_quest: "Meta Quest",
};

export interface NowPlayingInfo {
  gameId: number;
  title: string;
  coverPath: string | null;
  heroPath: string | null;
  platform: Platform;
  since: string;
}

export interface LastPlayedInfo {
  gameId: number;
  title: string;
  coverPath: string | null;
  platform: Platform;
  endedAt: string;
}

export interface RecentSession {
  id: number;
  gameId: number;
  title: string;
  coverPath: string | null;
  platform: Platform;
  startedAt: string;
  endedAt: string;
  durationMin: number;
  derived: boolean;
}

export interface PlaytimeWeek {
  totalMin: number;
  byPlatform: { steam: number; psn: number };
}

export interface DashboardResponse {
  nowPlaying: NowPlayingInfo | null;
  lastPlayed: LastPlayedInfo | null;
  recentSessions: RecentSession[];
  playtimeThisWeek: PlaytimeWeek;
}

export interface DashboardSummary {
  totalGames: number;
  lifetimeMin: number;
  finishedCount: number;
  perfectCount: number;
  artPaths: string[];
}

export interface DashboardHero {
  id: number;
  title: string;
  heroPath: string;
  coverPath: string | null;
}

export interface DailyPlayStat {
  date: string;
  totalMin: number;
}

export interface UpcomingGame {
  id: number;
  title: string;
  coverPath: string | null;
  releaseDate: string;
}

export interface LibraryGame {
  id: number;
  title: string;
  coverPath: string | null;
  status: GameStatus | null;
  platforms: Platform[];
  completionPct: number | null;
  matchStatus: MatchStatus;
  firstReleaseDate?: string | null;
  metacritic?: number | null;
  hltbMainExtraHours?: number | null;
  hltbMainHours?: number | null;
  hltbCompletionistHours?: number | null;
}

export interface IgdbSearchResult {
  igdbId: number;
  name: string;
  year: number | null;
  coverUrl: string | null;
  platforms: string[];
}

export interface Achievement {
  apiName: string;
  name: string;
  description: string | null;
  isHidden: boolean;
  icon: string | null;
  globalPct: number | null;
  dlcAppId: number | null;
  dlcAppName: string | null;
  unlockedAt: string | null;
}

export interface PlaySession {
  id: number;
  source: Platform;
  startedAt: string;
  endedAt: string;
  durationMin: number;
  derived: boolean;
}

export type PriceSource = "pc" | "psn" | "xbox" | "meta";

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  pc: "PC",
  psn: "PlayStation",
  xbox: "Xbox",
  meta: "Meta Quest",
};

export interface WishlistPrice {
  current: {
    price: number;
    regular: number;
    cut: number;
    shop: string;
    url: string;
  } | null;
  lowest: { price: number } | null;
  /** Storefront the price was quoted from, per the priority settings. */
  source: PriceSource | null;
  /** Sources this game is available on, in priority order. */
  candidates: PriceSource[];
  /** True when a per-game override chose the source. */
  overridden: boolean;
  /** False when `source` has no price provider configured yet. */
  supported: boolean;
}

export interface GameDetail {
  id: number;
  title: string;
  sortTitle: string | null;
  coverPath: string | null;
  heroPath: string | null;
  igdbId: number | null;
  matchStatus: MatchStatus;
  firstReleaseDate: string | null;
  summary: string | null;
  genres: string[];
  tags: string[];
  platforms: string[];
  hltbMainHours: number | null;
  hltbMainExtraHours: number | null;
  hltbCompletionistHours: number | null;
  metacritic: number | null;
  playtime: { source: Platform | "hltb" | "manual"; totalMin: number }[];
  lifetimeMin: number;
  sessions: PlaySession[];
  achievements: Achievement[];
  achievementTotal: number;
  achievementEarned: number;
  status: GameStatus | null;
  rating: number | null;
  notes: string | null;
  ownership: Platform[];
  lists: number[];
  steamAppId: string | null;
  controllerSupport: "none" | "partial" | "full" | null;
  steamReviewDesc: string | null;
  steamReviewPct: number | null;
  steamReviewCount: number | null;
  metacriticUrl: string | null;
  hidden: boolean;
  inWishlist: boolean;
  itadEnabled: boolean;
  vrSupported: boolean;
}

export interface QuestList {
  id: number;
  slug: string;
  name: string;
  kind: ListKind;
  systemKey: SystemKey | null;
  platform: Platform | null;
  sortOrder: number;
  itemCount: number;
}

export interface QuestListDetail {
  list: QuestList;
  games: LibraryGame[];
}

export interface PlatformAccount {
  platform: Platform;
  steamId64: string | null;
  hasNpsso: boolean;
  xuid: string | null;
  gamertag: string | null;
  lastSyncedAt: string | null;
  lastImportedAt: string | null;
  health: "green" | "amber" | "red";
  enabled: boolean;
  lastError: string | null;
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

export interface PlatformBreakdown {
  platform: Platform;
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

export interface HeatmapDay {
  date: string;
  minutes: number;
}

export interface CompletionsByYear {
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

export interface Stats {
  overview: StatsOverview;
  statusCounts: Record<string, number>;
  byPlatform: PlatformBreakdown[];
  byGenre: GenreBreakdown[];
  topPlayed: TopGame[];
  heatmap: HeatmapDay[];
  completionsByYear: CompletionsByYear[];
  rarityAchievements: RarityAchievement[];
  perfectGames: PerfectGame[];
}

export interface DiscoverGame {
  igdbId: number | null;
  steamAppId: number | null;
  name: string;
  coverUrl: string | null;
  year: number | null;
  releaseDate: string | null;
  summary: string | null;
  genres: string[];
  rating: number | null;
  aggregatedRating: number | null;
  follows: number | null;
  hypes: number | null;
  libraryId: number | null;
  finalPrice?: number | null;
  originalPrice?: number | null;
  discountPct?: number;
  currency?: string;
}

export interface GenreOption {
  id: number;
  name: string;
}

export interface DiscoverResponse {
  category: DiscoverCategory;
  page: number;
  hasNextPage: boolean;
  items: DiscoverGame[];
}

export interface ActivityEvent {
  type: string;
  at: string;
  gameId: number;
  gameTitle: string;
  coverPath: string | null;
  detail: string;
  extra?: string | null;
}

// ─── API error class ──────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ─── Auth refresh / 401 retry ───────────────────────────────────────────────

const AUTH_NO_RETRY_PATHS = new Set(["/api/auth/login", "/api/auth/refresh"]);

interface AuthHandlers {
  getRefreshToken?: () => Promise<string | null>;
  onTokenRefreshed?: (accessToken: string) => void;
  onAuthFailure?: () => void;
}

let authHandlers: AuthHandlers = {};

export function setAuthHandlers(handlers: AuthHandlers): void {
  authHandlers = handlers;
}

let refreshPromise: Promise<string> | null = null;

/**
 * Performs a silent token refresh, deduping concurrent callers onto a single
 * in-flight request. Resolves with the new access token; rejects (and
 * notifies onAuthFailure) if there's no stored refresh token, or it's no
 * longer valid.
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const stored = await authHandlers.getRefreshToken?.();
      if (!stored) throw new ApiError(401, "No refresh token available");
      const res = await request<{ accessToken: string }>("/api/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: stored }),
      });
      authHandlers.onTokenRefreshed?.(res.accessToken);
      return res.accessToken;
    })()
      .catch((err) => {
        authHandlers.onAuthFailure?.();
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// ─── Core request helper ──────────────────────────────────────────────────────

// Bounds a fetch so an unreachable host fails in seconds instead of hanging on the
// OS TCP-connect timeout (30–75s). Generous enough for legitimate slow LAN requests.
const REQUEST_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string; _isRetry?: boolean } = {}
): Promise<T> {
  const { token, _isRetry, ...init } = options;
  const headers = new Headers(init.headers as HeadersInit);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const base = await resolveApiBase();
  if (!base) throw new ApiError(0, "Can't reach the server (off-network without Tailscale?)");
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}${path}`, { ...init, headers });
  } catch (err) {
    // Network error / timeout — the cached base may have become unreachable (e.g.
    // Tailscale toggled or WiFi dropped). Re-probe once and retry; if nothing is
    // reachable now, surface the error instead of hanging.
    resetApiBase();
    const nextBase = await resolveApiBase();
    if (!nextBase || nextBase === base) throw err;
    res = await fetchWithTimeout(`${nextBase}${path}`, { ...init, headers });
  }
  if (!res.ok) {
    if (res.status === 401 && !_isRetry && token && !AUTH_NO_RETRY_PATHS.has(path)) {
      let newToken: string | undefined;
      try {
        newToken = await refreshAccessToken();
      } catch {
        // Refresh failed; fall through and surface the original 401.
      }
      if (newToken) {
        return request<T>(path, { ...options, token: newToken, _isRetry: true });
      }
    }
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? res.statusText
    );
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// ─── API surface (ported from apps/web/lib/api.ts) ────────────────────────────

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  login: (username: string, password: string) =>
    request<{ accessToken: string; refreshToken: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  refresh: (refreshToken: string) =>
    request<{ accessToken: string }>("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
  // Passwordless auto-login for trusted networks (LAN / Tailscale). Returns the
  // access token + a refresh token to persist in SecureStore; rejects (401) if untrusted.
  session: () =>
    request<{ accessToken: string; refreshToken: string }>("/api/auth/session", {
      method: "POST",
    }),
  logout: (token: string, refreshToken: string) =>
    request<void>("/api/auth/logout", {
      method: "POST",
      token,
      body: JSON.stringify({ refreshToken }),
    }),

  // ── Health ────────────────────────────────────────────────────────────────
  getHealth: () =>
    request<{ ok: boolean; uptime: number; db: string }>("/health"),

  // ── Dashboard ─────────────────────────────────────────────────────────────
  getDashboard: (token: string) =>
    request<DashboardResponse>("/api/dashboard", { token }),
  getNowPlaying: (token: string) =>
    request<{ nowPlaying: NowPlayingInfo | null; lastPlayed: LastPlayedInfo | null }>(
      "/api/now-playing",
      { token }
    ),
  getDashboardSummary: (token: string) =>
    request<DashboardSummary>("/api/dashboard/summary", { token }),
  getDashboardHero: (token: string) =>
    request<DashboardHero | null>("/api/dashboard/hero", { token }),
  getDashboardDailyStats: (token: string) =>
    request<DailyPlayStat[]>("/api/dashboard/daily-stats", { token }),
  getDashboardPlaying: (token: string) =>
    request<LibraryGame[]>("/api/dashboard/playing", { token }),
  getDashboardBacklog: (token: string) =>
    request<LibraryGame[]>("/api/dashboard/backlog", { token }),
  getDashboardUpcoming: (token: string) =>
    request<UpcomingGame[]>("/api/dashboard/upcoming", { token }),

  // ── Library ───────────────────────────────────────────────────────────────
  getLibrary: (
    token: string,
    params?: {
      platform?: string;
      genre?: string;
      status?: string;
      all?: boolean;
      hidden?: boolean;
      vr?: boolean;
      q?: string;
    }
  ) => {
    const qs = new URLSearchParams();
    if (params?.platform) qs.set("platform", params.platform);
    if (params?.genre) qs.set("genre", params.genre);
    if (params?.status) qs.set("status", params.status);
    if (params?.all) qs.set("all", "1");
    if (params?.hidden) qs.set("hidden", "1");
    if (params?.vr) qs.set("vr", "1");
    if (params?.q) qs.set("q", params.q);
    return request<LibraryGame[]>(
      `/api/library${qs.toString() ? `?${qs}` : ""}`,
      { token }
    );
  },

  // ── Games ─────────────────────────────────────────────────────────────────
  searchGames: (q: string, token: string) =>
    request<IgdbSearchResult[]>(
      `/api/games/search?q=${encodeURIComponent(q)}`,
      { token }
    ),
  addGame: (igdbId: number, token: string) =>
    request<{ id: number }>("/api/games", {
      method: "POST",
      body: JSON.stringify({ igdbId }),
      token,
    }),
  getGame: (id: number, token: string) =>
    request<GameDetail>(`/api/games/${id}`, { token }),
  setHidden: (id: number, hidden: boolean, token: string) =>
    request<GameDetail>(`/api/games/${id}/hidden`, {
      method: "PUT",
      body: JSON.stringify({ hidden }),
      token,
    }),
  setVr: (id: number, vr: boolean, token: string) =>
    request<GameDetail>(`/api/games/${id}/vr`, {
      method: "PUT",
      body: JSON.stringify({ vr }),
      token,
    }),
  getWishlistPrice: (id: number, token: string) =>
    request<WishlistPrice>(`/api/games/${id}/price`, { token }),

  // ── Status ────────────────────────────────────────────────────────────────
  setStatus: (gameId: number, status: GameStatus, token: string) =>
    request<void>(`/api/status/${gameId}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
      token,
    }),
  clearStatus: (gameId: number, token: string) =>
    request<void>(`/api/status/${gameId}`, { method: "DELETE", token }),

  // ── Ratings ───────────────────────────────────────────────────────────────
  setRating: (gameId: number, rating: number, token: string) =>
    request<void>(`/api/ratings/${gameId}`, {
      method: "PUT",
      body: JSON.stringify({ rating }),
      token,
    }),
  clearRating: (gameId: number, token: string) =>
    request<void>(`/api/ratings/${gameId}`, { method: "DELETE", token }),

  // ── Notes ─────────────────────────────────────────────────────────────────
  setNotes: (gameId: number, body: string, token: string) =>
    request<void>(`/api/notes/${gameId}`, {
      method: "PUT",
      body: JSON.stringify({ body }),
      token,
    }),
  clearNotes: (gameId: number, token: string) =>
    request<void>(`/api/notes/${gameId}`, { method: "DELETE", token }),

  // ── Ownership ─────────────────────────────────────────────────────────────
  addOwnership: (gameId: number, platform: Platform, token: string) =>
    request<void>("/api/ownership", {
      method: "POST",
      body: JSON.stringify({ gameId, platform }),
      token,
    }),
  removeOwnership: (gameId: number, platform: Platform, token: string) =>
    request<void>(`/api/ownership/${gameId}/${platform}`, {
      method: "DELETE",
      token,
    }),

  // ── Lists ─────────────────────────────────────────────────────────────────
  getLists: (token: string) =>
    request<QuestList[]>("/api/lists", { token }),
  getListDetail: (id: number, token: string) =>
    request<QuestListDetail>(`/api/lists/${id}`, { token }),
  createList: (name: string, token: string) =>
    request<QuestList>("/api/lists", {
      method: "POST",
      body: JSON.stringify({ name }),
      token,
    }),
  renameList: (id: number, name: string, token: string) =>
    request<QuestList>(`/api/lists/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
      token,
    }),
  deleteList: (id: number, token: string) =>
    request<void>(`/api/lists/${id}`, { method: "DELETE", token }),
  addListItem: (listId: number, gameId: number, token: string) =>
    request<void>(`/api/lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify({ gameId }),
      token,
    }),
  removeListItem: (listId: number, gameId: number, token: string) =>
    request<void>(`/api/lists/${listId}/items/${gameId}`, {
      method: "DELETE",
      token,
    }),
  reorderList: (listId: number, gameIds: number[], token: string) =>
    request<void>(`/api/lists/${listId}/reorder`, {
      method: "PUT",
      body: JSON.stringify({ gameIds }),
      token,
    }),

  // ── Platforms ─────────────────────────────────────────────────────────────
  getPlatforms: (token: string) =>
    request<PlatformAccount[]>("/api/platforms", { token }),
  setSteamAccount: (steamId64: string, enabled: boolean, token: string) =>
    request<PlatformAccount>("/api/platforms/steam", {
      method: "PUT",
      body: JSON.stringify({ steamId64, enabled }),
      token,
    }),
  setPsnAccount: (npsso: string, enabled: boolean, token: string) =>
    request<{ started: boolean }>("/api/platforms/psn", {
      method: "PUT",
      body: JSON.stringify({ npsso, enabled }),
      token,
    }),

  // ── Sync ──────────────────────────────────────────────────────────────────
  syncPlatform: (platform: Platform, token: string) =>
    request<{ ok: boolean }>(`/api/sync/${platform}`, {
      method: "POST",
      token,
    }),

  // ── Stats ─────────────────────────────────────────────────────────────────
  getStats: (token: string) =>
    request<Stats>("/api/stats", { token }),
  getStatsYears: (token: string) =>
    request<number[]>("/api/stats/years", { token }),
  getYearStats: (year: number, token: string) =>
    request<{
      year: number;
      playMinutes: number;
      sessionCount: number;
      gamesPlayed: number;
      gamesFinished: number;
      achievementsUnlocked: number;
      topPlayed: TopGame[];
    }>(`/api/stats/year/${year}`, { token }),
  getActivity: (token: string) =>
    request<ActivityEvent[]>("/api/stats/activity", { token }),

  // ── Discover ──────────────────────────────────────────────────────────────
  discover: (
    category: DiscoverCategory,
    token: string,
    params?: { page?: number; year?: number; genreId?: number }
  ) => {
    const qs = new URLSearchParams({ category });
    if (params?.page && params.page > 1) qs.set("page", String(params.page));
    if (params?.year) qs.set("year", String(params.year));
    if (params?.genreId) qs.set("genreId", String(params.genreId));
    return request<DiscoverResponse>(`/api/discover?${qs}`, { token });
  },
  getDiscoverGenres: (token: string) =>
    request<GenreOption[]>("/api/discover/genres", { token }),

  // ── Account ───────────────────────────────────────────────────────────────
  getMe: (token: string) =>
    request<{ id: number; username: string }>("/api/auth/me", { token }),
  updateAccount: (
    body: { newUsername?: string; currentPassword?: string; newPassword?: string },
    token: string
  ) =>
    request<{ updated: boolean }>("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify(body),
      token,
    }),
};
