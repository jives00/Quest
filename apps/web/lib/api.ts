import type { LoginResponse } from "@quest/types";

export type { LoginResponse };

// ─── Domain types ──────────────────────────────────────────────────────────

export type Platform = "steam" | "psn" | "xbox" | "epic" | "gog" | "meta_quest";
export type ImportSource = Platform;
export type GameStatus = "unplayed" | "playing" | "completed" | "other";

export const PLATFORM_LABELS: Record<Platform, string> = {
  steam: "Windows/Steam",
  psn: "PlayStation",
  xbox: "Xbox / Game Pass",
  epic: "Epic Games",
  gog: "GOG",
  meta_quest: "Meta Quest",
};
export type MatchStatus = "matched" | "provisional" | "manual";
export type ListKind = "system" | "platform" | "custom";
export type SystemKey = "backlog" | "wishlist" | "replay" | "vr";

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

export interface WishlistPrice {
  current: { price: number; shop: string; url: string } | null;
  lowest: { price: number } | null;
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
  playtime: { source: Platform | 'hltb' | 'manual'; totalMin: number }[];
  lifetimeMin: number;
  sessions: PlaySession[];
  achievements: Achievement[];
  achievementTotal: number;
  achievementEarned: number;
  status: GameStatus | null;
  rating: number | null;
  notes: string | null;
  ownership: Platform[];
  customOwnership: number[];
  lists: number[];
  // --- Enrichment fields ---
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
  trailerVideoIds: string[];
  screenshotImageIds: string[];
}

export interface GameMetadataPatch {
  title?: string;
  sortTitle?: string | null;
  summary?: string | null;
  coverPath?: string | null;
  heroPath?: string | null;
  firstReleaseDate?: string | null;
  metacritic?: number | null;
  hltbMainHours?: number | null;
  hltbMainExtraHours?: number | null;
  hltbCompletionistHours?: number | null;
  genres?: string[];
  tags?: string[];
  trailerVideoIds?: string[];
  screenshotImageIds?: string[];
}

export interface ArtworkCandidates {
  grids: string[];
  heroes: string[];
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

// ─── Completions ─────────────────────────────────────────────────────────────

export interface GameCompletion {
  id: number;
  completedAt: string;
  source: "status_change" | "manual";
}

// ─── Play history / timeline ─────────────────────────────────────────────────

export type HistoryPrecision = "exact" | "day" | "month" | "year" | "era";
export type HistoryStatus = "playing" | "completed" | "other";
export type TimelineKind = "session" | "achievement" | "manual" | "status";

export interface TimelineItem {
  kind: TimelineKind;
  at: string | null;
  source: string | null;
  value: number | null;
  status: string | null;
  note: string | null;
  precision: HistoryPrecision | null;
  occurredEnd: string | null;
  manualId: number | null;
}

export interface CreateHistoryInput {
  gameId: number;
  occurredStart?: string | null;
  occurredEnd?: string | null;
  precision?: HistoryPrecision;
  status?: HistoryStatus | null;
  platform?: string | null;
  note?: string | null;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

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

export interface HeatmapDay {
  date: string;
  minutes: number;
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

export type ActivityEventType = "session" | "achievement" | "completion" | "status" | "wishlist" | "backlog" | "ownership";

export interface ActivityEvent {
  type: ActivityEventType;
  at: string;
  gameId: number;
  gameTitle: string;
  coverPath: string | null;
  detail: string;
  extra?: string | null;
}

export interface RecentPlatformPlaytime {
  platform: string;
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

export interface YearStats {
  year: number;
  playMinutes: number;
  sessionCount: number;
  gamesPlayed: number;
  gamesFinished: number;
  achievementsUnlocked: number;
  gamesAcquired: number;
  topPlayed: TopGame[];
  finishedTitles: { gameId: number; title: string; status: string; at: string }[];
}

// ─── Discover ─────────────────────────────────────────────────────────────────

export type DiscoverCategory =
  | 'trending'
  | 'new_releases'
  | 'anticipated'
  | 'top_rated'
  | 'steam_top_sellers'
  | 'by_genre';

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

export interface ImportResult {
  source: ImportSource;
  count: number;
  started: boolean;
}

export interface ProvisionalMatch {
  gameId: number;
  title: string;
  coverPath: string | null;
  platform: Platform;
  externalId: string;
}

export interface PlatformOverride {
  platform: Platform;
  name: string | null;
  icon: string | null;
}

export interface UserPlatform {
  id: number;
  name: string;
  icon: string | null;
  slug: string;
  sortOrder: number;
  createdAt: string;
}

export interface DuplicateCandidate {
  game1: { id: number; title: string; coverPath: string | null; platform: Platform };
  game2: { id: number; title: string; coverPath: string | null; platform: Platform };
  score: number;
}

// ─── API client ────────────────────────────────────────────────────────────

const BASE = "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const activeControllers = new Set<AbortController>();

export function createApiController(): { signal: AbortSignal; abort: () => void } {
  const controller = new AbortController();
  activeControllers.add(controller);
  return {
    signal: controller.signal,
    abort: () => {
      controller.abort();
      activeControllers.delete(controller);
    },
  };
}

export function cancelAllRequests(): void {
  for (const controller of activeControllers) {
    controller.abort();
  }
  activeControllers.clear();
}

// ─── Auth refresh / 401 retry ───────────────────────────────────────────────

const AUTH_NO_RETRY_PATHS = new Set(["/api/auth/login", "/api/auth/refresh"]);

interface AuthHandlers {
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
 * notifies onAuthFailure) if the refresh token is no longer valid.
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = request<{ accessToken: string }>("/api/auth/refresh", { method: "POST" })
      .then((res) => {
        authHandlers.onTokenRefreshed?.(res.accessToken);
        return res.accessToken;
      })
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

async function request<T>(
  path: string,
  options: RequestInit & { token?: string; signal?: AbortSignal; _isRetry?: boolean } = {}
): Promise<T> {
  const { token, signal, _isRetry, ...init } = options;
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: "include", signal });
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
      throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      console.error(`API ${path} returned status ${res.status} with invalid JSON:`, text);
      throw new ApiError(0, `Invalid JSON response from ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    if (signal?.aborted) {
      activeControllers.forEach((c) => {
        if (c.signal === signal) activeControllers.delete(c);
      });
    }
  }
}

export const api = {
  // ── Auth ────────────────────────────────────────────────────────────────
  login: (username: string, password: string) =>
    request<{ accessToken: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  refresh: () =>
    request<{ accessToken: string }>("/api/auth/refresh", { method: "POST" }),
  logout: (token: string) =>
    request<void>("/api/auth/logout", { method: "POST", token }),

  // ── Health ──────────────────────────────────────────────────────────────
  getHealth: () =>
    request<{ ok: boolean; uptime: number; db: string }>("/health"),

  // ── Dashboard ───────────────────────────────────────────────────────────
  getDashboard: (token: string, signal?: AbortSignal) =>
    request<DashboardResponse>("/api/dashboard", { token, signal }),
  getNowPlaying: (token: string, signal?: AbortSignal) =>
    request<{ nowPlaying: NowPlayingInfo | null; lastPlayed: LastPlayedInfo | null }>(
      "/api/now-playing", { token, signal }
    ),
  getDashboardSummary: (token: string, signal?: AbortSignal) =>
    request<DashboardSummary>("/api/dashboard/summary", { token, signal }),
  getDashboardHero: (token: string, seed: number, signal?: AbortSignal) =>
    request<DashboardHero | null>(`/api/dashboard/hero?seed=${seed}`, { token, signal }),
  getDashboardDailyStats: (token: string, signal?: AbortSignal) =>
    request<DailyPlayStat[]>("/api/dashboard/daily-stats", { token, signal }),
  getDashboardPlaying: (token: string, signal?: AbortSignal) =>
    request<LibraryGame[]>("/api/dashboard/playing", { token, signal }),
  getDashboardBacklog: (token: string, signal?: AbortSignal) =>
    request<LibraryGame[]>("/api/dashboard/backlog", { token, signal }),
  getDashboardUpcoming: (token: string, signal?: AbortSignal) =>
    request<UpcomingGame[]>("/api/dashboard/upcoming", { token, signal }),

  // ── Library ─────────────────────────────────────────────────────────────
  getLibrary: (token: string, params?: { platform?: string; customPlatformId?: number; genre?: string; status?: string; all?: boolean; hidden?: boolean; vr?: boolean; q?: string }, signal?: AbortSignal) => {
    const qs = new URLSearchParams();
    if (params?.platform) qs.set("platform", params.platform);
    if (params?.customPlatformId) qs.set("customPlatformId", String(params.customPlatformId));
    if (params?.genre) qs.set("genre", params.genre);
    if (params?.status) qs.set("status", params.status);
    if (params?.all) qs.set("all", "1");
    if (params?.hidden) qs.set("hidden", "1");
    if (params?.vr) qs.set("vr", "1");
    if (params?.q) qs.set("q", params.q);
    return request<LibraryGame[]>(`/api/library${qs.toString() ? `?${qs}` : ""}`, { token, signal });
  },

  // ── Games ───────────────────────────────────────────────────────────────
  searchGames: (q: string, token: string, signal?: AbortSignal) =>
    request<IgdbSearchResult[]>(`/api/games/search?q=${encodeURIComponent(q)}`, { token, signal }),
  addGame: (igdbId: number, token: string) =>
    request<{ id: number }>("/api/games", { method: "POST", body: JSON.stringify({ igdbId }), token }),
  getGame: (id: number, token: string, signal?: AbortSignal) =>
    request<GameDetail>(`/api/games/${id}`, { token, signal }),
  deleteGame: (id: number, token: string) =>
    request<void>(`/api/games/${id}`, { method: "DELETE", token }),
  updateGameMetadata: (id: number, patch: GameMetadataPatch, token: string) =>
    request<GameDetail>(`/api/games/${id}/metadata`, { method: "PATCH", body: JSON.stringify(patch), token }),
  rematchGame: (id: number, igdbId: number, token: string) =>
    request<GameDetail>(`/api/games/${id}/rematch`, { method: "POST", body: JSON.stringify({ igdbId }), token }),
  getArtwork: (id: number, token: string, q?: string, signal?: AbortSignal) =>
    request<ArtworkCandidates>(`/api/games/${id}/artwork${q ? `?q=${encodeURIComponent(q)}` : ""}`, { token, signal }),
  enrichGame: (id: number, token: string) =>
    request<GameDetail>(`/api/games/${id}/enrich`, { method: "POST", token }),
  setHidden: (id: number, hidden: boolean, token: string) =>
    request<GameDetail>(`/api/games/${id}/hidden`, { method: "PUT", body: JSON.stringify({ hidden }), token }),
  setVr: (id: number, vr: boolean, token: string) =>
    request<GameDetail>(`/api/games/${id}/vr`, { method: "PUT", body: JSON.stringify({ vr }), token }),
  setManualPlaytime: (id: number, minutes: number | null, token: string) =>
    request<GameDetail>(`/api/games/${id}/playtime/manual`, { method: "PUT", body: JSON.stringify({ minutes }), token }),
  getWishlistPrice: (id: number, token: string, signal?: AbortSignal) =>
    request<WishlistPrice>(`/api/games/${id}/price`, { token, signal }),

  // ── Status ──────────────────────────────────────────────────────────────
  setStatus: (gameId: number, status: GameStatus, token: string) =>
    request<void>(`/api/status/${gameId}`, { method: "PUT", body: JSON.stringify({ status }), token }),
  clearStatus: (gameId: number, token: string) =>
    request<void>(`/api/status/${gameId}`, { method: "DELETE", token }),

  // ── Ratings ─────────────────────────────────────────────────────────────
  setRating: (gameId: number, rating: number, token: string) =>
    request<void>(`/api/ratings/${gameId}`, { method: "PUT", body: JSON.stringify({ rating }), token }),
  clearRating: (gameId: number, token: string) =>
    request<void>(`/api/ratings/${gameId}`, { method: "DELETE", token }),

  // ── Notes ───────────────────────────────────────────────────────────────
  setNotes: (gameId: number, body: string, token: string) =>
    request<void>(`/api/notes/${gameId}`, { method: "PUT", body: JSON.stringify({ body }), token }),
  clearNotes: (gameId: number, token: string) =>
    request<void>(`/api/notes/${gameId}`, { method: "DELETE", token }),

  // ── Ownership ───────────────────────────────────────────────────────────
  addOwnership: (gameId: number, platform: Platform, token: string) =>
    request<void>("/api/ownership", { method: "POST", body: JSON.stringify({ gameId, platform }), token }),
  removeOwnership: (gameId: number, platform: Platform, token: string) =>
    request<void>(`/api/ownership/${gameId}/${platform}`, { method: "DELETE", token }),
  addCustomOwnership: (gameId: number, platformId: number, token: string) =>
    request<void>("/api/custom-ownership", { method: "POST", body: JSON.stringify({ gameId, platformId }), token }),
  removeCustomOwnership: (gameId: number, platformId: number, token: string) =>
    request<void>(`/api/custom-ownership/${gameId}/${platformId}`, { method: "DELETE", token }),

  // ── Lists ───────────────────────────────────────────────────────────────
  getLists: (token: string, signal?: AbortSignal) =>
    request<QuestList[]>("/api/lists", { token, signal }),
  getListDetail: (id: number, token: string, signal?: AbortSignal) =>
    request<QuestListDetail>(`/api/lists/${id}`, { token, signal }),
  createList: (name: string, token: string) =>
    request<QuestList>("/api/lists", { method: "POST", body: JSON.stringify({ name }), token }),
  renameList: (id: number, name: string, token: string) =>
    request<QuestList>(`/api/lists/${id}`, { method: "PATCH", body: JSON.stringify({ name }), token }),
  deleteList: (id: number, token: string) =>
    request<void>(`/api/lists/${id}`, { method: "DELETE", token }),
  addListItem: (listId: number, gameId: number, token: string) =>
    request<void>(`/api/lists/${listId}/items`, { method: "POST", body: JSON.stringify({ gameId }), token }),
  removeListItem: (listId: number, gameId: number, token: string) =>
    request<void>(`/api/lists/${listId}/items/${gameId}`, { method: "DELETE", token }),
  reorderList: (listId: number, gameIds: number[], token: string) =>
    request<void>(`/api/lists/${listId}/reorder`, { method: "PUT", body: JSON.stringify({ gameIds }), token }),

  // ── Sessions ────────────────────────────────────────────────────────────
  getSessions: (token: string, page = 1, limit = 20, signal?: AbortSignal) =>
    request<{ sessions: PlaySession[]; total: number }>(`/api/sessions?page=${page}&limit=${limit}`, { token, signal }),
  patchSession: (id: number, data: { startedAt?: string; endedAt?: string }, token: string) =>
    request<PlaySession>(`/api/sessions/${id}`, { method: "PATCH", body: JSON.stringify(data), token }),
  deleteSession: (id: number, token: string) =>
    request<void>(`/api/sessions/${id}`, { method: "DELETE", token }),
  mergeSessions: (ids: number[], token: string) =>
    request<PlaySession>("/api/sessions/merge", { method: "POST", body: JSON.stringify({ ids }), token }),

  // ── Platforms ───────────────────────────────────────────────────────────
  getPlatforms: (token: string, signal?: AbortSignal) =>
    request<PlatformAccount[]>("/api/platforms", { token, signal }),
  setSteamAccount: (steamId64: string, enabled: boolean, token: string) =>
    request<PlatformAccount>("/api/platforms/steam", { method: "PUT", body: JSON.stringify({ steamId64, enabled }), token }),
  setPsnAccount: (npsso: string, enabled: boolean, token: string) =>
    request<{ started: boolean }>("/api/platforms/psn", { method: "PUT", body: JSON.stringify({ npsso, enabled }), token }),
  setXboxAccount: (enabled: boolean, token: string) =>
    request<{ started: boolean; xuid: string; gamertag: string }>("/api/platforms/xbox", { method: "PUT", body: JSON.stringify({ enabled }), token }),

  // ── Sync ────────────────────────────────────────────────────────────────
  syncPlatform: (platform: Platform, token: string) =>
    request<{ ok: boolean }>(`/api/sync/${platform}`, { method: "POST", token }),

  // ── Imports (Epic / GOG / Meta Quest) ─────────────────────────────────────
  importLibrary: (source: ImportSource, csv: string, token: string) =>
    request<ImportResult>(`/api/imports/${source}`, { method: "POST", body: JSON.stringify({ csv }), token }),

  // ── Completions ───────────────────────────────────────────────────────────
  getCompletions: (gameId: number, token: string, signal?: AbortSignal) =>
    request<GameCompletion[]>(`/api/games/${gameId}/completions`, { token, signal }),
  addCompletion: (gameId: number, completedAt: string | null, token: string) =>
    request<GameCompletion>(`/api/games/${gameId}/completions`, {
      method: "POST",
      body: JSON.stringify(completedAt ? { completedAt } : {}),
      token,
    }),
  deleteCompletion: (id: number, token: string) =>
    request<void>(`/api/completions/${id}`, { method: "DELETE", token }),

  // ── History / timeline ────────────────────────────────────────────────────
  getTimeline: (gameId: number, token: string, signal?: AbortSignal) =>
    request<TimelineItem[]>(`/api/games/${gameId}/timeline`, { token, signal }),
  createHistory: (input: CreateHistoryInput, token: string) =>
    request<{ id: number }>("/api/history", { method: "POST", body: JSON.stringify(input), token }),
  updateHistory: (id: number, input: Partial<CreateHistoryInput>, token: string) =>
    request<{ updated: boolean }>(`/api/history/${id}`, { method: "PATCH", body: JSON.stringify(input), token }),
  deleteHistory: (id: number, token: string) =>
    request<void>(`/api/history/${id}`, { method: "DELETE", token }),

  // ── Stats ───────────────────────────────────────────────────────────────
  getStats: (token: string, tzOffset?: number, signal?: AbortSignal) =>
    request<Stats>(`/api/stats${tzOffset !== undefined ? `?tz=${tzOffset}` : ""}`, { token, signal }),
  getStatsYears: (token: string, signal?: AbortSignal) =>
    request<number[]>("/api/stats/years", { token, signal }),
  getYearStats: (year: number, token: string, signal?: AbortSignal) =>
    request<YearStats>(`/api/stats/year/${year}`, { token, signal }),
  getActivity: (token: string, signal?: AbortSignal) =>
    request<ActivityEvent[]>("/api/stats/activity", { token, signal }),

  // ── Discover ────────────────────────────────────────────────────────────
  discover: (
    category: DiscoverCategory,
    token: string,
    params?: { page?: number; year?: number; genreId?: number },
    signal?: AbortSignal,
  ) => {
    const qs = new URLSearchParams({ category });
    if (params?.page && params.page > 1) qs.set('page', String(params.page));
    if (params?.year) qs.set('year', String(params.year));
    if (params?.genreId) qs.set('genreId', String(params.genreId));
    return request<DiscoverResponse>(`/api/discover?${qs}`, { token, signal });
  },
  getDiscoverGenres: (token: string, signal?: AbortSignal) =>
    request<GenreOption[]>('/api/discover/genres', { token, signal }),

  // ── Matching ─────────────────────────────────────────────────────────────
  getProvisionalMatches: (token: string, signal?: AbortSignal) =>
    request<ProvisionalMatch[]>("/api/matching/provisional", { token, signal }),
  resolveMatch: (gameId: number, igdbId: number, token: string) =>
    request<void>(`/api/matching/${gameId}/resolve`, { method: "POST", body: JSON.stringify({ igdbId }), token }),
  getDuplicates: (token: string, signal?: AbortSignal) =>
    request<DuplicateCandidate[]>("/api/matching/duplicates", { token, signal }),
  mergeGames: (winnerId: number, loserId: number, token: string) =>
    request<void>("/api/matching/merge", { method: "POST", body: JSON.stringify({ winnerId, loserId }), token }),
  dismissDuplicate: (game1Id: number, game2Id: number, token: string) =>
    request<void>("/api/matching/duplicates/dismiss", { method: "POST", body: JSON.stringify({ game1Id, game2Id }), token }),

  // ── User Platforms ───────────────────────────────────────────────────────
  getUserPlatforms: (token: string) =>
    request<UserPlatform[]>("/api/user-platforms", { token }),
  getPlatformOverrides: (token: string) =>
    request<PlatformOverride[]>("/api/platform-overrides", { token }),
  setPlatformOverride: (platform: Platform, patch: { name?: string | null; icon?: string | null }, token: string) =>
    request<{ updated: boolean }>(`/api/platform-overrides/${platform}`, { method: "PUT", body: JSON.stringify(patch), token }),

  addUserPlatform: (name: string, icon: string | null, token: string) =>
    request<{ id: number; name: string; icon: string | null; slug: string }>("/api/user-platforms", {
      method: "POST", body: JSON.stringify({ name, icon }), token,
    }),
  updateUserPlatform: (id: number, patch: { name?: string; icon?: string | null }, token: string) =>
    request<{ updated: boolean }>(`/api/user-platforms/${id}`, {
      method: "PATCH", body: JSON.stringify(patch), token,
    }),
  deleteUserPlatform: (id: number, token: string) =>
    request<{ deleted: boolean }>(`/api/user-platforms/${id}`, { method: "DELETE", token }),

  // ── Account ─────────────────────────────────────────────────────────────
  getMe: (token: string) =>
    request<{ id: number; username: string }>("/api/auth/me", { token }),
  updateAccount: (body: { newUsername?: string; currentPassword?: string; newPassword?: string }, token: string) =>
    request<{ updated: boolean }>("/api/auth/me", { method: "PATCH", body: JSON.stringify(body), token }),

  // ── Export ───────────────────────────────────────────────────────────────
  exportData: async (token: string): Promise<void> => {
    const BASE_URL = typeof window !== "undefined" ? "" : (process.env.NEXT_PUBLIC_API_BASE ?? "");
    const res = await fetch(`${BASE_URL}/api/export`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
    });
    if (!res.ok) throw new ApiError(res.status, "Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const cd = res.headers.get("Content-Disposition") ?? "";
    const match = cd.match(/filename="([^"]+)"/);
    a.download = match?.[1] ?? "quest-export.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  },
};
