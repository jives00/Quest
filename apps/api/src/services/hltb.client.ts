// ---------------------------------------------------------------------------
// HowLongToBeat client — hand-rolled against the live site API
// ---------------------------------------------------------------------------
// HLTB has no official API. The `howlongtobeat` npm package (v1.8.0, latest)
// posts to the retired `/api/search` endpoint and 404s on every request, so it
// is unusable. This client talks to the current endpoint instead, which is
// protected by a lightweight anti-bot handshake reverse-engineered from their
// Next.js bundle (subject to change without notice):
//
//   1. GET  /api/bleed/init?t=<ts>  -> { token, hpKey, hpVal }
//   2. POST /api/bleed              with headers x-auth-token / x-hp-key /
//      x-hp-val, and the hpKey:hpVal pair also mirrored into the JSON body.
//
// Search results carry play times in SECONDS (comp_main / comp_plus / comp_100).
// No API key required. If HLTB changes their handshake, requests fail softly and
// searchHltb returns null (callers treat that as "no data").
// ---------------------------------------------------------------------------

const BASE_URL = 'https://howlongtobeat.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const COMMON_HEADERS = {
  'User-Agent': UA,
  origin: BASE_URL,
  referer: `${BASE_URL}/`,
};

interface BleedInit {
  token: string;
  hpKey: string;
  hpVal: string;
}

interface HltbApiEntry {
  game_name: string;
  comp_main: number; // seconds
  comp_plus: number; // seconds
  comp_100: number; // seconds
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HltbResult {
  /** Game title as returned by HLTB */
  title: string;
  /** Main story hours (null when not available) */
  mainStoryHours: number | null;
  /** Main + extras hours */
  mainExtraHours: number | null;
  /** Completionist hours */
  completionistHours: number | null;
}

// ---------------------------------------------------------------------------
// Enable guard
// ---------------------------------------------------------------------------

/** Returns true when HLTB integration is active. */
export function isHltbEnabled(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** seconds → hours, rounded to one decimal; null for non-positive input. */
function secsToHours(secs: number): number | null {
  if (!secs || secs <= 0) return null;
  return Math.round((secs / 3600) * 10) / 10;
}

/** Fetch the per-request security handshake. */
async function fetchBleedInit(): Promise<BleedInit | null> {
  const res = await fetch(`${BASE_URL}/api/bleed/init?t=${Date.now()}`, {
    headers: COMMON_HEADERS,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Partial<BleedInit>;
  if (!json.token) return null;
  return { token: json.token, hpKey: json.hpKey ?? '', hpVal: json.hpVal ?? '' };
}

function buildSearchBody(terms: string[], init: BleedInit): Record<string, unknown> {
  const body: Record<string, unknown> = {
    searchType: 'games',
    searchTerms: terms,
    searchPage: 1,
    size: 20,
    searchOptions: {
      games: {
        userId: 0,
        platform: '',
        sortCategory: 'popular',
        rangeCategory: 'main',
        rangeTime: { min: 0, max: 0 },
        gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
        rangeYear: { min: '', max: '' },
        modifier: '',
      },
      users: { sortCategory: 'postcount' },
      lists: { sortCategory: 'follows' },
      filter: '',
      sort: 0,
      randomizer: 0,
    },
    useCache: true,
  };
  // The frontend mirrors the honeypot pair into the body as well.
  if (init.hpKey) body[init.hpKey] = init.hpVal;
  return body;
}

/** Pick the entry whose name best matches the query (exact, case-insensitive), else the first. */
function pickBestMatch(entries: HltbApiEntry[], query: string): HltbApiEntry | null {
  if (!entries.length) return null;
  const norm = (s: string) => s.toLowerCase().trim();
  const exact = entries.find((e) => norm(e.game_name) === norm(query));
  return exact ?? entries[0];
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Search HLTB for a game and return timing data.
 * Returns null when no match is found or the request fails.
 */
export async function searchHltb(title: string): Promise<HltbResult | null> {
  try {
    const init = await fetchBleedInit();
    if (!init) return null;

    const terms = title.trim().split(/\s+/).filter(Boolean);
    const res = await fetch(`${BASE_URL}/api/bleed`, {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Content-Type': 'application/json',
        'x-auth-token': init.token,
        'x-hp-key': init.hpKey,
        'x-hp-val': init.hpVal,
      },
      body: JSON.stringify(buildSearchBody(terms, init)),
    });
    if (!res.ok) {
      console.error(`HLTB search returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as { data?: HltbApiEntry[] };
    const top = pickBestMatch(data.data ?? [], title);
    if (!top) return null;

    return {
      title: top.game_name,
      mainStoryHours: secsToHours(top.comp_main),
      mainExtraHours: secsToHours(top.comp_plus),
      completionistHours: secsToHours(top.comp_100),
    };
  } catch (err) {
    console.error('HLTB search failed:', err);
    return null;
  }
}

/**
 * Convenience: return only main-story hours for a given title.
 * Returns null when not found.
 */
export async function getMainStoryHours(title: string): Promise<number | null> {
  const result = await searchHltb(title);
  return result?.mainStoryHours ?? null;
}
