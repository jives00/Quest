const STEAM_BASE = 'https://api.steampowered.com';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.STEAM_API_KEY ?? '';
  if (!key) {
    throw new Error('STEAM_API_KEY must be set');
  }
  return key;
}

/** Returns true when STEAM_API_KEY is present in the environment. */
export function isSteamEnabled(): boolean {
  return Boolean(process.env.STEAM_API_KEY);
}

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface SteamPlayerSummary {
  steamId: string;
  personaName: string;
  /** 0=Offline, 1=Online, 2=Busy, 3=Away, 4=Snooze, 5=LookingToTrade, 6=LookingToPlay */
  personaState: number;
  /** Steam appid of the currently running game, or null if not in-game. */
  gameId: string | null;
  /** Human-readable game name reported by Steam while in-game, or null. */
  gameExtraInfo: string | null;
}

export interface SteamOwnedGame {
  appId: number;
  name: string;
  /** Total playtime in minutes (lifetime). */
  playtimeForeverMin: number;
  /** Unix timestamp of last play session, or null when Steam reports 0. */
  playtimeLastPlayed: number | null;
  /** Small icon hash for `http://media.steampowered.com/steamcommunity/public/images/apps/{appid}/{hash}.jpg` */
  imgIconUrl: string | null;
}

export interface SteamRecentGame {
  appId: number;
  name: string;
  /** Total lifetime playtime in minutes. */
  playtimeForeverMin: number;
  /** Playtime in minutes over the last two weeks. */
  playtime2weeksMin: number;
}

export interface SteamWishlistItem {
  appId: number;
  /** Lower number = higher priority in the user's wishlist ordering. */
  priority: number;
  /** Unix timestamp when added to the wishlist, or null. */
  dateAdded: number | null;
}

export interface SteamAchievement {
  apiName: string;
  achieved: boolean;
  /** Unix timestamp when unlocked, or null when Steam reports 0 (locked). */
  unlockTime: number | null;
  /** Display name returned by GetPlayerAchievements (includes hidden unlocked achievements). */
  name: string | null;
  /** Description returned by GetPlayerAchievements — reveals hidden achievement text when unlocked. */
  description: string | null;
}

export interface SteamAchievementSchema {
  apiName: string;
  displayName: string;
  description: string | null;
  isHidden: boolean;
  icon: string | null;
  iconGray: string | null;
}

/** Richer achievement schema from IPlayerService/GetGameAchievements/v1 — includes hidden descriptions and global %. */
export interface SteamGameAchievement {
  apiName: string;
  displayName: string;
  description: string | null;
  isHidden: boolean;
  icon: string | null;
  iconGray: string | null;
  globalPct: number | null;
}

export interface SteamDbAchievementGroup {
  dlcAppId: number | null;
  dlcAppName: string;
  achievementApiNames: string[];
}

// ---------------------------------------------------------------------------
// Raw Steam response shapes (internal — not exported)
// ---------------------------------------------------------------------------

interface RawPlayerSummary {
  steamid?: string;
  personaname?: string;
  personastate?: number;
  gameid?: string;
  gameextrainfo?: string;
}

interface RawOwnedGame {
  appid?: number;
  name?: string;
  playtime_forever?: number;
  rtime_last_played?: number;
  img_icon_url?: string;
}

interface RawRecentGame {
  appid?: number;
  name?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
}

interface RawPlayerAchievement {
  apiname?: string;
  achieved?: number;
  unlocktime?: number;
  name?: string;
  description?: string;
}

interface RawAchievementSchema {
  name?: string;
  displayName?: string;
  description?: string;
  hidden?: number | string;
  icon?: string;
  icongray?: string;
}

// ---------------------------------------------------------------------------
// Shared fetch helper
// ---------------------------------------------------------------------------

async function steamGet<T>(
  path: string,
  params: Record<string, string>,
): Promise<T> {
  const key = getApiKey();
  const url = new URL(`${STEAM_BASE}/${path}`);
  url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Steam API ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Fetch presence / in-game status for a single Steam user.
 *
 * `gameId` being non-null signals the user is currently in-game.
 * Steam requires the profile to be public for game details to appear.
 */
export async function getPlayerSummary(
  steamId64: string,
): Promise<SteamPlayerSummary> {
  const data = await steamGet<{
    response?: { players?: RawPlayerSummary[] };
  }>('ISteamUser/GetPlayerSummaries/v0002/', { steamids: steamId64 });

  const player = data?.response?.players?.[0];
  if (!player) {
    // Profile may be private or the steamId was invalid — return a safe default.
    return {
      steamId: steamId64,
      personaName: '',
      personaState: 0,
      gameId: null,
      gameExtraInfo: null,
    };
  }

  return {
    steamId: player.steamid ?? steamId64,
    personaName: player.personaname ?? '',
    personaState: player.personastate ?? 0,
    gameId: player.gameid != null && player.gameid !== '' ? player.gameid : null,
    gameExtraInfo: player.gameextrainfo != null && player.gameextrainfo !== ''
      ? player.gameextrainfo
      : null,
  };
}

/**
 * Fetch the full owned-games library for a Steam user.
 *
 * Returns `[]` for private profiles (Steam returns `{ response: {} }`).
 * Requests app info and includes free-to-play games.
 */
export async function getOwnedGames(steamId64: string): Promise<SteamOwnedGame[]> {
  const data = await steamGet<{
    response?: { games?: RawOwnedGame[]; game_count?: number };
  }>('IPlayerService/GetOwnedGames/v0001/', {
    steamid: steamId64,
    include_appinfo: '1',
    include_played_free_games: '1',
  });

  const games = data?.response?.games;
  if (!Array.isArray(games) || games.length === 0) {
    return [];
  }

  return games.map((g): SteamOwnedGame => {
    const lastPlayed = g.rtime_last_played ?? 0;
    return {
      appId: g.appid ?? 0,
      name: g.name ?? '',
      playtimeForeverMin: g.playtime_forever ?? 0,
      playtimeLastPlayed: lastPlayed > 0 ? lastPlayed : null,
      imgIconUrl:
        g.img_icon_url != null && g.img_icon_url !== '' ? g.img_icon_url : null,
    };
  });
}

/**
 * Fetch games played in the last two weeks.
 *
 * Returns `[]` when the user hasn't played recently or the profile is private.
 */
export async function getRecentlyPlayedGames(
  steamId64: string,
): Promise<SteamRecentGame[]> {
  const data = await steamGet<{
    response?: { total_count?: number; games?: RawRecentGame[] };
  }>('IPlayerService/GetRecentlyPlayedGames/v0001/', { steamid: steamId64 });

  const games = data?.response?.games;
  if (!Array.isArray(games) || games.length === 0) {
    return [];
  }

  return games.map((g): SteamRecentGame => ({
    appId: g.appid ?? 0,
    name: g.name ?? '',
    playtimeForeverMin: g.playtime_forever ?? 0,
    playtime2weeksMin: g.playtime_2weeks ?? 0,
  }));
}

/**
 * Fetch a user's Steam wishlist (appids + priority + date added).
 *
 * Uses IWishlistService/GetWishlist, which returns clean JSON for public
 * profiles. Returns `[]` when the wishlist is empty or the profile is private.
 */
export async function getWishlist(steamId64: string): Promise<SteamWishlistItem[]> {
  const data = await steamGet<{
    response?: { items?: Array<{ appid?: number; priority?: number; date_added?: number }> };
  }>('IWishlistService/GetWishlist/v1/', { steamid: steamId64 });

  const items = data?.response?.items;
  if (!Array.isArray(items)) return [];

  return items
    .filter((i): i is { appid: number; priority?: number; date_added?: number } => typeof i.appid === 'number')
    .map((i) => ({
      appId: i.appid,
      priority: i.priority ?? 0,
      dateAdded: i.date_added && i.date_added > 0 ? i.date_added : null,
    }));
}

/**
 * Fetch a user's earned achievements for a specific app.
 *
 * Steam returns a non-ok-ish JSON payload (with `success: false`) for games
 * that have no achievements, or when the user's stats are private. This is
 * caught and normalised to `[]` so callers never have to guard.
 */
export async function getPlayerAchievements(
  steamId64: string,
  appId: number,
): Promise<SteamAchievement[]> {
  let data: {
    playerstats?: {
      success?: boolean;
      error?: string;
      achievements?: RawPlayerAchievement[];
    };
  };

  try {
    data = await steamGet('ISteamUserStats/GetPlayerAchievements/v0001/', {
      steamid: steamId64,
      appid: String(appId),
      l: 'english',
    });
  } catch {
    // Non-ok HTTP (e.g. 400 for games with no stats schema) — treat as empty.
    return [];
  }

  const stats = data?.playerstats;
  // Steam signals "no achievements / private" with success=false in the body.
  if (!stats || stats.success === false || !Array.isArray(stats.achievements)) {
    return [];
  }

  return stats.achievements.map((a): SteamAchievement => {
    const unlockTime = a.unlocktime ?? 0;
    return {
      apiName: a.apiname ?? '',
      achieved: a.achieved === 1,
      unlockTime: unlockTime > 0 ? unlockTime : null,
      name: a.name != null && a.name !== '' ? a.name : null,
      description: a.description != null && a.description !== '' ? a.description : null,
    };
  });
}

/**
 * Fetch the achievement schema (definitions) for a game.
 *
 * Returns `[]` when the game has no achievements or the schema is unavailable.
 */
export async function getSchemaForGame(
  appId: number,
): Promise<SteamAchievementSchema[]> {
  let data: {
    game?: {
      availableGameStats?: {
        achievements?: RawAchievementSchema[];
      };
    };
  };

  try {
    data = await steamGet('ISteamUserStats/GetSchemaForGame/v2/', {
      appid: String(appId),
      l: 'english',
    });
  } catch {
    // Non-ok HTTP (e.g. 400 when the game has no stats schema at all).
    return [];
  }

  const achievements = data?.game?.availableGameStats?.achievements;
  if (!Array.isArray(achievements) || achievements.length === 0) {
    return [];
  }

  return achievements.map((a): SteamAchievementSchema => ({
    apiName: a.name ?? '',
    displayName: a.displayName ?? '',
    description:
      a.description != null && a.description !== '' ? a.description : null,
    isHidden: a.hidden === 1 || a.hidden === '1',
    icon: a.icon != null && a.icon !== '' ? a.icon : null,
    iconGray: a.icongray != null && a.icongray !== '' ? a.icongray : null,
  }));
}

/**
 * Fetch global unlock percentages for all achievements in a game.
 *
 * Returns an empty map when the game has no stats or Steam returns an error.
 */
export async function getGlobalAchievementPercentages(
  appId: number,
): Promise<Map<string, number>> {
  let data: {
    achievementpercentages?: {
      achievements?: Array<{ name?: string; percent?: number }>;
    };
  };

  try {
    data = await steamGet(
      'ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/',
      { gameid: String(appId) },
    );
  } catch {
    return new Map();
  }

  const list = data?.achievementpercentages?.achievements;
  if (!Array.isArray(list)) return new Map();

  return new Map(
    list
      .filter(a => a.name != null)
      .map(a => [a.name!, a.percent ?? 0]),
  );
}

/**
 * Fetch full achievement schema via IPlayerService/GetGameAchievements/v1.
 *
 * Unlike GetSchemaForGame, this endpoint returns descriptions for hidden
 * achievements and includes global unlock % in one call.
 * Returns `[]` on failure — callers should fall back to getSchemaForGame.
 */
export async function getGameAchievementsV1(
  appId: number,
): Promise<SteamGameAchievement[]> {
  let data: {
    response?: {
      achievements?: Array<{
        internal_name?: string;
        localized_name?: string;
        localized_desc?: string;
        hidden?: boolean;
        icon?: string;
        icon_gray?: string;
        player_percent_unlocked?: string;
      }>;
    };
  };

  try {
    data = await steamGet('IPlayerService/GetGameAchievements/v1/', {
      appid: String(appId),
      language: 'english',
    });
  } catch {
    return [];
  }

  const list = data?.response?.achievements;
  if (!Array.isArray(list) || list.length === 0) return [];

  const iconBase = `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appId}/`;

  return list.map((a): SteamGameAchievement => ({
    apiName: a.internal_name ?? '',
    displayName: a.localized_name ?? '',
    description: a.localized_desc != null && a.localized_desc !== '' ? a.localized_desc : null,
    isHidden: a.hidden === true,
    icon: a.icon ? `${iconBase}${a.icon}` : null,
    iconGray: a.icon_gray ? `${iconBase}${a.icon_gray}` : null,
    globalPct: a.player_percent_unlocked != null ? parseFloat(a.player_percent_unlocked) : null,
  }));
}

/**
 * Fetch achievement-to-DLC grouping from SteamDB's extension API.
 *
 * Returns `[]` on any failure — DLC grouping is best-effort only.
 * Unofficial endpoint; may break or rate-limit without notice.
 */
export async function getSteamDbAchievementGroups(
  appId: number,
): Promise<SteamDbAchievementGroup[]> {
  try {
    const url = `https://extension.steamdb.info/api/ExtensionGetAchievements/?appid=${appId}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'SteamDB',
      },
    });
    if (!res.ok) return [];

    const body = await res.json() as {
      success?: boolean;
      data?: Array<{
        name?: string;
        dlcAppName?: string;
        dlcAppId?: number;
        achievementApiNames?: string[];
      }>;
    };

    if (!body.success || !Array.isArray(body.data)) return [];

    return body.data.map(g => ({
      dlcAppId: g.dlcAppId ?? null,
      dlcAppName: g.dlcAppName ?? g.name ?? 'DLC',
      achievementApiNames: g.achievementApiNames ?? [],
    }));
  } catch {
    return [];
  }
}
