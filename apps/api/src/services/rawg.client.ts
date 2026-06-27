const RAWG_BASE = 'https://api.rawg.io/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawgPlatformEntry {
  platform: {
    id: number;
    name: string;
    slug: string;
  };
}

export interface RawgGame {
  id: number;
  name: string;
  slug: string;
  released: string | null; // "YYYY-MM-DD"
  background_image: string | null;
  platforms: RawgPlatformEntry[] | null;
  metacritic: number | null;
}

interface RawgSearchResponse {
  count: number;
  results: RawgGame[];
}

// ---------------------------------------------------------------------------
// Enable guard
// ---------------------------------------------------------------------------

/**
 * Returns true when RAWG_API_KEY is configured.
 * The matching service calls this before using RAWG, so the key is optional.
 */
export function isRawgEnabled(): boolean {
  return Boolean(process.env.RAWG_API_KEY);
}

// ---------------------------------------------------------------------------
// Internal GET helper
// ---------------------------------------------------------------------------

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.RAWG_API_KEY ?? '';
  const url = new URL(`${RAWG_BASE}${path}`);
  url.searchParams.set('key', key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`RAWG ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Search RAWG for games by title.
 * Returns [] when RAWG_API_KEY is not set — the matching service skips this step gracefully.
 */
export async function searchGames(query: string, pageSize = 10): Promise<RawgGame[]> {
  if (!isRawgEnabled()) return [];

  const data = await get<RawgSearchResponse>('/games', {
    search: query,
    page_size: String(pageSize),
  });

  return data.results ?? [];
}

/**
 * Fetch a single RAWG game by its numeric id.
 * Returns null when RAWG is disabled.
 */
export async function getGameById(rawgId: number): Promise<RawgGame | null> {
  if (!isRawgEnabled()) return null;

  const res = await get<RawgGame>(`/games/${rawgId}`);
  return res;
}
