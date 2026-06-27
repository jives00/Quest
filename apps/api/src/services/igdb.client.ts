const IGDB_BASE = 'https://api.igdb.com/v4';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IgdbCover {
  id: number;
  image_id: string;
}

export interface IgdbGenre {
  id: number;
  name: string;
}

export interface IgdbPlatform {
  id: number;
  name: string;
}

export interface IgdbGame {
  id: number;
  name: string;
  slug?: string;
  first_release_date?: number; // Unix timestamp
  summary?: string;
  cover?: IgdbCover;
  genres?: IgdbGenre[];
  platforms?: IgdbPlatform[];
  /** IGDB community rating (0–100) */
  rating?: number;
  rating_count?: number;
  /** External critic aggregated rating (0–100) */
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  follows?: number;
  hypes?: number;
}

export type DiscoverCategory =
  | 'trending'
  | 'new_releases'
  | 'anticipated'
  | 'top_rated'
  | 'by_genre';

export interface IgdbDiscoverOptions {
  category: DiscoverCategory;
  page?: number;
  year?: number;
  genreId?: number;
  limit?: number;
}

export interface IgdbSearchOptions {
  limit?: number;
  /** IGDB platform id filter (e.g. 6 = PC, 167 = PS5) */
  platformId?: number;
}

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const clientId = process.env.IGDB_CLIENT_ID ?? '';
  const clientSecret = process.env.IGDB_CLIENT_SECRET ?? '';

  if (!clientId || !clientSecret) {
    throw new Error('IGDB_CLIENT_ID and IGDB_CLIENT_SECRET must be set');
  }

  const url = new URL(TWITCH_TOKEN_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  const res = await fetch(url.toString(), { method: 'POST' });
  if (!res.ok) {
    throw new Error(`IGDB token fetch failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

function clearToken(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

// ---------------------------------------------------------------------------
// Throttle — IGDB allows 4 requests/second.
// Dependency-free limiter: serialize scheduling so each request starts at least
// 250ms after the previous one (≤4 starts/second).
// ---------------------------------------------------------------------------

const MIN_SPACING_MS = 250;
let throttleChain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function acquireSlot(): Promise<void> {
  throttleChain = throttleChain.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_SPACING_MS - Date.now());
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  return throttleChain;
}

async function rawPost(endpoint: string, body: string): Promise<Response> {
  await acquireSlot();
  const token = await getAccessToken();
  const clientId = process.env.IGDB_CLIENT_ID ?? '';

  const doFetch = (bearer: string) =>
    fetch(`${IGDB_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'text/plain',
      },
      body,
    });

  const res = await doFetch(token);

  // Retry once on 401 (expired token)
  if (res.status === 401) {
    clearToken();
    const freshToken = await getAccessToken();
    return doFetch(freshToken);
  }

  return res;
}

async function post<T>(endpoint: string, body: string): Promise<T> {
  const res = await rawPost(endpoint, body);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`IGDB ${res.status}: ${endpoint} — ${errText}`);
  }
  return res.json() as Promise<T>;
}

/** Run an arbitrary Apicalypse body against an endpoint and return the raw parsed JSON. */
export async function rawQuery(endpoint: string, body: string): Promise<unknown> {
  return post<unknown>(endpoint, body);
}

// ---------------------------------------------------------------------------
// Common Apicalypse field set for games
// ---------------------------------------------------------------------------

const GAME_FIELDS =
  'fields id,name,slug,first_release_date,summary,cover.image_id,' +
  'genres.name,platforms.name,rating,rating_count,aggregated_rating,aggregated_rating_count,follows,hypes;';

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Search IGDB for games by query string.
 * Returns up to `opts.limit` results (default 10).
 */
export async function searchGames(
  query: string,
  opts: IgdbSearchOptions = {},
): Promise<IgdbGame[]> {
  const limit = opts.limit ?? 10;

  // Each Apicalypse clause must be ';'-terminated.
  const body =
    `${GAME_FIELDS}` +
    ` search "${query.replace(/"/g, '')}";` +
    (opts.platformId != null ? ` where platforms = (${opts.platformId});` : '') +
    ` limit ${limit};`;

  return post<IgdbGame[]>('games', body);
}

/**
 * Fetch a single game by IGDB id with full metadata.
 */
export async function getGameById(igdbId: number): Promise<IgdbGame | null> {
  const body = `${GAME_FIELDS} where id = ${igdbId}; limit 1;`;
  const results = await post<IgdbGame[]>('games', body);
  return results[0] ?? null;
}

/**
 * Fetch all platforms (useful for seeding local lookups).
 */
export async function getPlatforms(): Promise<IgdbPlatform[]> {
  return post<IgdbPlatform[]>('platforms', 'fields id,name; limit 500;');
}

/**
 * Fetch all genres (useful for seeding local lookups).
 */
export async function getGenres(): Promise<IgdbGenre[]> {
  return post<IgdbGenre[]>('genres', 'fields id,name; limit 200;');
}

/**
 * Fetch games for a discovery category with optional filters and pagination.
 */
export async function discoverGames(opts: IgdbDiscoverOptions): Promise<IgdbGame[]> {
  const limit = opts.limit ?? 24;
  const page = opts.page ?? 1;
  const offset = (page - 1) * limit;

  const now = Math.floor(Date.now() / 1000);
  const days90ago = now - 90 * 24 * 60 * 60;
  const days180ago = now - 180 * 24 * 60 * 60;

  let whereClause: string;
  let sortClause: string;

  // category = 0 intentionally omitted: IGDB leaves this field absent on many
  // recently-released games, so filtering on it returns empty results.
  switch (opts.category) {
    case 'trending':
      whereClause = `where first_release_date >= ${days90ago} & first_release_date <= ${now} & genres != null;`;
      sortClause = 'sort rating_count desc;';
      break;
    case 'new_releases':
      whereClause = `where first_release_date >= ${days180ago} & first_release_date <= ${now} & genres != null & rating_count > 5;`;
      sortClause = 'sort first_release_date desc;';
      break;
    case 'anticipated':
      whereClause = `where first_release_date > ${now} & genres != null;`;
      sortClause = 'sort hypes desc;';
      break;
    case 'top_rated': {
      let yearFilter = '';
      if (opts.year) {
        const yearStart = Math.floor(new Date(opts.year, 0, 1).getTime() / 1000);
        const yearEnd = Math.floor(new Date(opts.year + 1, 0, 1).getTime() / 1000);
        yearFilter = ` & first_release_date >= ${yearStart} & first_release_date < ${yearEnd}`;
      }
      whereClause = `where aggregated_rating >= 75 & aggregated_rating_count >= 5 & genres != null${yearFilter};`;
      sortClause = 'sort aggregated_rating desc;';
      break;
    }
    case 'by_genre':
      if (!opts.genreId) throw new Error('genreId required for by_genre');
      whereClause = `where genres = (${opts.genreId});`;
      sortClause = 'sort rating desc;';
      break;
    default:
      throw new Error(`Unknown discover category: ${opts.category}`);
  }

  const body = `${GAME_FIELDS} ${whereClause} ${sortClause} limit ${limit}; offset ${offset};`;
  return post<IgdbGame[]>('games', body);
}

/**
 * Build the public CDN URL for an IGDB cover image.
 * Does NOT download the file — the matching/games service handles persistence.
 *
 * Common sizes: t_thumb (90×128), t_cover_big (264×374), t_720p, t_1080p.
 */
export function coverUrl(imageId: string, size = 't_cover_big'): string {
  return `${IMAGE_BASE}/${size}/${imageId}.jpg`;
}
