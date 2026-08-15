const STEAMGRIDDB_BASE = 'https://www.steamgriddb.com/api/v2';

/** Grid sizes that are capsule-shaped (2.1395), as accepted by ?dimensions=. */
const CAPSULE_DIMENSIONS = '460x215,920x430';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SteamGridDbImage {
  id: number;
  score: number;
  style: string;
  url: string;
  width?: number;
  height?: number;
  thumb: string;
  tags: string[];
  author: {
    name: string;
    steam64: string;
    avatar: string;
  };
}

interface SteamGridDbResponse<T> {
  success: boolean;
  data: T;
}

export interface SteamGridDbGame {
  id: number;
  name: string;
  release_date: number | null;
  types: string[];
}

// ---------------------------------------------------------------------------
// Enable guard
// ---------------------------------------------------------------------------

/**
 * Returns true when STEAMGRIDDB_KEY is configured.
 */
export function isSteamGridDbEnabled(): boolean {
  return Boolean(process.env.STEAMGRIDDB_KEY);
}

// ---------------------------------------------------------------------------
// Internal GET helper
// ---------------------------------------------------------------------------

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.STEAMGRIDDB_KEY ?? '';
  const url = new URL(`${STEAMGRIDDB_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) throw new Error(`SteamGridDB ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Search SteamGridDB for a game by name.
 * Returns null when STEAMGRIDDB_KEY is not set.
 */
export async function searchGame(name: string): Promise<SteamGridDbGame | null> {
  if (!isSteamGridDbEnabled()) return null;

  // SteamGridDB takes the search term as a path segment, not a query param.
  const data = await get<SteamGridDbResponse<SteamGridDbGame[]>>(
    `/search/autocomplete/${encodeURIComponent(name)}`,
  );

  return data.success && data.data.length > 0 ? (data.data[0] ?? null) : null;
}

/**
 * Fetch grid (portrait box-art / cover) images for a SteamGridDB game id.
 * Returns null when STEAMGRIDDB_KEY is not set.
 */
export async function getGrid(
  steamgriddbGameId: number,
): Promise<SteamGridDbImage[] | null> {
  if (!isSteamGridDbEnabled()) return null;

  const data = await get<SteamGridDbResponse<SteamGridDbImage[]>>(
    `/grids/game/${steamgriddbGameId}`,
  );
  return data.success ? data.data : null;
}

/**
 * Fetch hero (wide landscape) images for a SteamGridDB game id.
 * Returns null when STEAMGRIDDB_KEY is not set.
 */
export async function getHeroArt(
  steamgriddbGameId: number,
): Promise<SteamGridDbImage[] | null> {
  if (!isSteamGridDbEnabled()) return null;

  const data = await get<SteamGridDbResponse<SteamGridDbImage[]>>(
    `/heroes/game/${steamgriddbGameId}`,
  );
  return data.success ? data.data : null;
}

/**
 * Fetch capsule (wide ~460x215 store banner) images for a SteamGridDB game id.
 *
 * Capsules live on the /grids endpoint under the capsule dimensions — they are
 * NOT /heroes, which are the far wider 1920x620 library banners that crop hard
 * and often have the game logo baked in.
 *
 * Returns null when STEAMGRIDDB_KEY is not set.
 */
export async function getCapsuleArt(
  steamgriddbGameId: number,
): Promise<SteamGridDbImage[] | null> {
  if (!isSteamGridDbEnabled()) return null;

  const data = await get<SteamGridDbResponse<SteamGridDbImage[]>>(
    `/grids/game/${steamgriddbGameId}`,
    { dimensions: CAPSULE_DIMENSIONS, types: 'static' },
  );
  if (!data.success) return null;

  // Belt-and-braces: the `dimensions` filter is applied server-side, but a
  // portrait grid slipping through would be stored as a capsule and then get
  // cropped to ribbons in a 2.14 slot. Re-check the ratio on anything that
  // reports its size, and keep images that don't report one.
  return data.data.filter(img => {
    if (!img.width || !img.height) return true;
    const ratio = img.width / img.height;
    return ratio >= 1.9 && ratio <= 2.4;
  });
}

/**
 * Convenience: look up a game by name then return its best grid image URL.
 * Returns null when disabled or no results found.
 */
export async function getBestGridUrl(name: string): Promise<string | null> {
  if (!isSteamGridDbEnabled()) return null;

  const game = await searchGame(name);
  if (!game) return null;

  const grids = await getGrid(game.id);
  if (!grids || grids.length === 0) return null;

  // Sort by community score descending, take the best
  const sorted = [...grids].sort((a, b) => b.score - a.score);
  return sorted[0]?.url ?? null;
}

/**
 * Convenience: look up a game by name then return its best hero art URL.
 * Returns null when disabled or no results found.
 */
export async function getBestHeroUrl(name: string): Promise<string | null> {
  if (!isSteamGridDbEnabled()) return null;

  const game = await searchGame(name);
  if (!game) return null;

  const heroes = await getHeroArt(game.id);
  if (!heroes || heroes.length === 0) return null;

  const sorted = [...heroes].sort((a, b) => b.score - a.score);
  return sorted[0]?.url ?? null;
}

/**
 * Convenience: look up a game by name then return its best capsule URL.
 *
 * This is the fallback for games with no Steam appid — PSN/Xbox/Meta entries.
 * Returns null when disabled or no capsule-sized grid exists.
 */
export async function getBestCapsuleUrl(name: string): Promise<string | null> {
  if (!isSteamGridDbEnabled()) return null;

  const game = await searchGame(name);
  if (!game) return null;

  const capsules = await getCapsuleArt(game.id);
  if (!capsules || capsules.length === 0) return null;

  const sorted = [...capsules].sort((a, b) => b.score - a.score);
  return sorted[0]?.url ?? null;
}
