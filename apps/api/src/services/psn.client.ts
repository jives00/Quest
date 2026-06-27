// PlayStation Network client — hand-rolled against PSN's mobile API.
//
// We deliberately do NOT depend on `psn-api` (ESM-only; the Quest API is CommonJS,
// same constraint that forced the IGDB/HLTB hand-rolls). The auth flow and endpoints
// below mirror what psn-api does:
//   1. NPSSO cookie  -> authorization code (302 Location on the authorize endpoint)
//   2. auth code     -> access/refresh token (Basic auth, the well-known mobile app creds)
//   3. bearer token  -> gamelist (playDuration!), trophies (earned timestamps), presence
//
// Fragility: unofficial endpoints, NPSSO lives ~2 months and must be re-pasted, and
// PlayStation can change any of this without notice. Every fetch fails loudly so the
// poller can flip the account to health='red'.

const AUTH_BASE = 'https://ca.account.sony.com/api/authz/v3/oauth';
const API_BASE = 'https://m.np.playstation.com/api';

// The official PlayStation mobile app's OAuth client (public knowledge; used by psn-api).
const CLIENT_ID = '09515159-7237-4370-9b40-3806e67c0891';
const CLIENT_SECRET = 'ucPjka5tntB2KqsP';
const REDIRECT_URI = 'com.scee.psxandroid.scecompcall://redirect';
const SCOPE = 'psn:mobile.v2.core psn:clientapp';

export function isPsnEnabled(): boolean {
  return Boolean(process.env.PSN_NPSSO);
}

// ---------------------------------------------------------------------------
// Exported shapes
// ---------------------------------------------------------------------------

export interface PsnPlayedTitle {
  /** Stable concept id used as the psn_concept external id (preferred over titleId). */
  conceptId: string;
  /** Per-title id (npTitleId), fallback external id when concept is absent. */
  titleId: string;
  name: string;
  imageUrl: string | null;
  /** Cumulative playtime in minutes parsed from the ISO-8601 playDuration. */
  playMinutes: number;
  lastPlayed: Date | null;
  firstPlayed: Date | null;
}

export interface PsnPresence {
  /** Title currently being played, or null when not in a game. */
  titleName: string | null;
  /** npTitleId of the running title, or null. */
  titleId: string | null;
}

export interface PsnTrophyTitle {
  npCommunicationId: string;
  titleName: string;
  iconUrl: string | null;
  /** 'trophy2' for PS5 titles, 'trophy' for PS4/PS3/Vita — REQUIRED on trophy fetches. */
  npServiceName: string;
  /** Earned/total counts across bronze..platinum, for progress %. */
  progress: number;
  lastUpdated: Date | null;
}

export interface PsnTrophy {
  /** trophyId is unique within a title — used as the achievement api_name. */
  apiName: string;
  name: string;
  icon: string | null;
  earned: boolean;
  earnedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Auth — NPSSO -> access token, cached in-memory with refresh
// ---------------------------------------------------------------------------

interface TokenState {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let tokenState: TokenState | null = null;

/** Step 1: exchange the NPSSO cookie for a short-lived authorization code. */
async function npssoToCode(npsso: string): Promise<string> {
  const url =
    `${AUTH_BASE}/authorize?access_type=offline` +
    `&client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPE)}`;

  const res = await fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { Cookie: `npsso=${npsso}` },
  });

  // The code comes back on the redirect Location header (?code=...).
  const location = res.headers.get('location') ?? '';
  const match = location.match(/[?&]code=([^&]+)/);
  if (!match) {
    throw new Error('PSN auth failed — NPSSO likely expired (no code in redirect)');
  }
  return match[1];
}

/** Step 2: exchange the authorization code for an access token. */
async function codeToToken(code: string): Promise<TokenState> {
  const body = new URLSearchParams({
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
    token_format: 'jwt',
  });

  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`PSN token exchange failed (${res.status})`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('PSN token exchange returned no access_token');
  return {
    accessToken: data.access_token,
    // Refresh a minute early to avoid edge-of-expiry 401s.
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
  };
}

async function getAccessToken(npsso: string): Promise<string> {
  if (tokenState && tokenState.expiresAt > Date.now()) {
    return tokenState.accessToken;
  }
  const code = await npssoToCode(npsso);
  tokenState = await codeToToken(code);
  return tokenState.accessToken;
}

async function psnGet<T>(npsso: string, path: string): Promise<T> {
  const token = await getAccessToken(npsso);
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.status === 401) {
    // Token may have been revoked mid-flight — drop the cache and retry once.
    tokenState = null;
    const fresh = await getAccessToken(npsso);
    const retry = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${fresh}`, Accept: 'application/json' },
    });
    if (!retry.ok) throw new Error(`PSN API ${retry.status} for ${path}`);
    return retry.json() as Promise<T>;
  }
  if (!res.ok) throw new Error(`PSN API ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// ISO-8601 duration -> minutes  (e.g. "PT12H30M15S" -> 750)
// ---------------------------------------------------------------------------

function isoDurationToMinutes(d: string | undefined): number {
  if (!d) return 0;
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const hours = Number(m[1] ?? 0);
  const mins = Number(m[2] ?? 0);
  const secs = Number(m[3] ?? 0);
  return Math.round(hours * 60 + mins + secs / 60);
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// PSN's gamelist mixes in non-game media apps (they accrue "playtime" on the console).
// Drop anything whose category looks like an app, plus the common streaming apps by name.
const MEDIA_APP_NAME =
  /^(youtube|netflix|disney|disney\+|prime video|amazon prime|amazon video|plex|spotify|twitch|hulu|crunchyroll|apple tv|hbo|max|peacock|pluto|tubi|funimation|vudu|bbc|wwe|nba|mlb|paramount)/i;

function isMediaApp(category: string | undefined, name: string | undefined): boolean {
  if (category && /app/i.test(category)) return true;
  if (name && MEDIA_APP_NAME.test(name.trim())) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * The "play history" game list — the key endpoint. Unlike trophies it carries real
 * cumulative `playDuration` (ISO-8601) + first/last played per title, so PSN gets
 * genuine playtime deltas through the same session algorithm as Steam.
 */
export async function getPlayedTitles(npsso: string): Promise<PsnPlayedTitle[]> {
  // No `categories` filter — it silently drops anything not matching the exact
  // category strings. Page through the whole play-history list (PSN caps page size
  // around 200) so large libraries come back in full, not just the first page.
  const out: PsnPlayedTitle[] = [];
  const limit = 200;
  let offset = 0;

  for (let page = 0; page < 50; page++) {
    const data = await psnGet<{
      titles?: Array<{
        titleId?: string;
        name?: string;
        category?: string;
        imageUrl?: string;
        playDuration?: string;
        firstPlayedDateTime?: string;
        lastPlayedDateTime?: string;
        concept?: { id?: number | string };
      }>;
      totalItemCount?: number;
    }>(npsso, `/gamelist/v2/users/me/titles?limit=${limit}&offset=${offset}`);

    const titles = data?.titles;
    if (!Array.isArray(titles) || titles.length === 0) break;

    for (const t of titles) {
      if (!t.titleId && t.concept?.id == null) continue;
      if (isMediaApp(t.category, t.name)) continue; // skip YouTube/Disney+/Prime/Plex/etc.
      out.push({
        conceptId: t.concept?.id != null ? String(t.concept.id) : String(t.titleId),
        titleId: t.titleId ?? String(t.concept?.id),
        name: t.name ?? '',
        imageUrl: t.imageUrl ?? null,
        playMinutes: isoDurationToMinutes(t.playDuration),
        lastPlayed: parseDate(t.lastPlayedDateTime),
        firstPlayed: parseDate(t.firstPlayedDateTime),
      });
    }

    offset += titles.length;
    const total = data.totalItemCount ?? out.length;
    if (titles.length < limit || offset >= total) break;
  }

  return out;
}

/** Best-effort presence. PSN presence is fragile; any failure resolves to "not playing". */
export async function getPresence(npsso: string): Promise<PsnPresence> {
  try {
    const data = await psnGet<{
      basicPresence?: {
        gameTitleInfoList?: Array<{ titleName?: string; npTitleId?: string }>;
      };
    }>(npsso, '/userProfile/v1/internal/users/me/basicPresences?type=primary');

    const game = data?.basicPresence?.gameTitleInfoList?.[0];
    return {
      titleName: game?.titleName ?? null,
      titleId: game?.npTitleId ?? null,
    };
  } catch {
    return { titleName: null, titleId: null };
  }
}

/** Trophy titles (one per game) — the comprehensive played-games list. Paginated. */
export async function getTrophyTitles(npsso: string): Promise<PsnTrophyTitle[]> {
  const raw: Array<{
    npCommunicationId?: string;
    npServiceName?: string;
    trophyTitleName?: string;
    trophyTitleIconUrl?: string;
    progress?: number;
    lastUpdatedDateTime?: string;
  }> = [];
  const limit = 200;
  let offset = 0;

  for (let page = 0; page < 50; page++) {
    const data = await psnGet<{
      totalItemCount?: number;
      trophyTitles?: typeof raw;
    }>(npsso, `/trophy/v1/users/me/trophyTitles?limit=${limit}&offset=${offset}`);

    const batch = data?.trophyTitles;
    if (!Array.isArray(batch) || batch.length === 0) break;
    raw.push(...batch);
    offset += batch.length;
    const total = data.totalItemCount ?? raw.length;
    if (batch.length < limit || offset >= total) break;
  }

  return raw
    .filter(t => t.npCommunicationId)
    .map((t): PsnTrophyTitle => ({
      npCommunicationId: t.npCommunicationId as string,
      titleName: t.trophyTitleName ?? '',
      iconUrl: t.trophyTitleIconUrl ?? null,
      npServiceName: t.npServiceName ?? 'trophy',
      progress: t.progress ?? 0,
      lastUpdated: parseDate(t.lastUpdatedDateTime),
    }));
}

/** Earned trophies for a title, with earn timestamps (the historical play signal).
 *  `npServiceName` ('trophy2' for PS5, 'trophy' otherwise) is REQUIRED or PSN 404s. */
export async function getTrophies(
  npsso: string,
  npCommunicationId: string,
  npServiceName: string,
): Promise<PsnTrophy[]> {
  const svc = `?npServiceName=${encodeURIComponent(npServiceName)}`;
  // Two calls: trophy definitions (names/icons) + the user's earned state/timestamps.
  const [defs, earned] = await Promise.all([
    psnGet<{
      trophies?: Array<{ trophyId?: number; trophyName?: string; trophyIconUrl?: string }>;
    }>(npsso, `/trophy/v1/npCommunicationIds/${npCommunicationId}/trophyGroups/all/trophies${svc}`),
    psnGet<{
      trophies?: Array<{ trophyId?: number; earned?: boolean; earnedDateTime?: string }>;
    }>(npsso, `/trophy/v1/users/me/npCommunicationIds/${npCommunicationId}/trophyGroups/all/trophies${svc}`),
  ]);

  const defMap = new Map(
    (defs?.trophies ?? []).map(d => [d.trophyId, d]),
  );

  return (earned?.trophies ?? [])
    .filter(t => t.trophyId != null)
    .map((t): PsnTrophy => {
      const d = defMap.get(t.trophyId);
      return {
        apiName: `trophy_${t.trophyId}`,
        name: d?.trophyName ?? `Trophy ${t.trophyId}`,
        icon: d?.trophyIconUrl ?? null,
        earned: t.earned === true,
        earnedAt: parseDate(t.earnedDateTime),
      };
    });
}
