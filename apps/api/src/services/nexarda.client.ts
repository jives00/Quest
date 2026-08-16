// ---------------------------------------------------------------------------
// NEXARDA — PlayStation Store pricing. Free, no API key, no approval.
//
// Replaces PlatPrices, whose free-tier key application was rejected. NEXARDA's
// public v3 API needs no auth, so `psn` is unconditionally available rather
// than key-gated.
//
// Two calls, because prices are keyed by NEXARDA's own game id:
//   1. /api/v3/search?type=games&q=<title>  → game_info.id
//   2. /api/v3/prices?type=game&id=<id>     → offers across ~90 retailers
//
// Lookup is by NAME for the same reason PlatPrices was: PSN concept ids only
// ever land on games the PSN poller has seen *played*, and a wishlisted game
// has never been played, so every wishlisted PlayStation title carries none.
//
// Terms (github.com/NEXARDA/NEXARDA): their offer URLs are affiliate links and
// must be passed through unmodified, which is what we do — `url` is stored
// verbatim. Reselling the data is prohibited; this is a single-user tracker.
// ---------------------------------------------------------------------------

const NEXARDA_BASE = 'https://www.nexarda.com/api/v3';
const UA = 'Quest-Tracker/1.0 (personal game library tracker)';
const REQUEST_SPACING_MS = 400; // undocumented limits; they block "abusive" traffic

/** The storefront we care about. NEXARDA also carries resellers; we ignore those. */
const PSN_STORE_NAME = 'PlayStation Store';

export interface PsnPrice {
  price: number;
  regular: number;
  cut: number;
  shop: string;
  url: string;
}

/**
 * NEXARDA needs no credentials, so PlayStation pricing is always available.
 * Kept as a function to mirror the other clients' enable guards.
 */
export function isNexardaEnabled(): boolean {
  return true;
}

// Module-level gate so concurrent callers still queue behind the spacing.
let lastRequestAt = 0;
let pending: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  pending = pending.then(async () => {
    const wait = lastRequestAt + REQUEST_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  return pending;
}

async function getJson(url: string): Promise<unknown | null> {
  await throttle();
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) {
    console.warn(`[NEXARDA] HTTP ${res.status} for ${url}`);
    return null;
  }
  return res.json();
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * NEXARDA quotes in a currency, not a country. Only the currencies matching
 * countries this app actually sends are mapped; anything else falls back to
 * USD, which is what every existing cache row is priced in.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD',
  CA: 'CAD',
  GB: 'GBP',
  AU: 'AUD',
  NZ: 'NZD',
  JP: 'JPY',
  DE: 'EUR',
  FR: 'EUR',
  ES: 'EUR',
  IT: 'EUR',
  NL: 'EUR',
  IE: 'EUR',
};

function currencyFor(country: string): string {
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? 'USD';
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

interface NexardaSearchItem {
  game_info?: { id?: number; name?: string } | null;
}

interface NexardaSearchResponse {
  success?: boolean;
  results?: { items?: NexardaSearchItem[] } | null;
}

/**
 * Resolve a title to a NEXARDA game id.
 *
 * Prefers an exact normalized name match and falls back to the first result,
 * which NEXARDA already ranks by relevance. A wrong match here prices the
 * wrong game, so the fallback is deliberately limited to the top hit rather
 * than scanning for anything vaguely similar.
 */
export async function lookupNexardaGameId(title: string): Promise<number | null> {
  try {
    const url = new URL(`${NEXARDA_BASE}/search`);
    url.searchParams.set('type', 'games');
    url.searchParams.set('q', title);

    const json = (await getJson(url.toString())) as NexardaSearchResponse | null;
    const items = json?.results?.items;
    if (!Array.isArray(items) || !items.length) {
      console.warn(`[NEXARDA] no search results for "${title}"`);
      return null;
    }

    const games = items.filter((i) => typeof i.game_info?.id === 'number');
    if (!games.length) return null;

    const want = normalizeTitle(title);
    const exact = games.find((g) => normalizeTitle(g.game_info?.name ?? '') === want);
    return (exact ?? games[0]).game_info?.id ?? null;
  } catch (err) {
    console.warn(`[NEXARDA] search error for "${title}":`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

interface NexardaOffer {
  url?: string;
  store?: { name?: string; official?: boolean } | null;
  edition?: string;
  edition_full?: string;
  region?: string;
  platform?: string;
  available?: boolean;
  price?: number;
  discount?: number;
}

interface NexardaPricesResponse {
  success?: boolean;
  prices?: { list?: NexardaOffer[] } | null;
}

/** Endings real storefront list prices actually use, most common first. */
const LIST_PRICE_ENDINGS = [0.99, 0.49, 0.0, 0.95, 0.9];
const SNAP_TOLERANCE = 0.03;

/**
 * Round a back-computed list price onto a plausible retail price.
 *
 * `regular` is derived as price / (1 - cut), and an integer discount percent
 * loses enough precision to land a cent off — a $29.99 game at 40% off
 * back-computes to $29.983. Snapping to a nearby conventional ending recovers
 * the real number; outside the tolerance the raw value is kept rather than
 * bent to fit.
 */
function snapToListPrice(value: number): number {
  const floor = Math.floor(value);
  for (const ending of LIST_PRICE_ENDINGS) {
    for (const base of [floor, floor + 1]) {
      const candidate = Math.round((base + ending) * 100) / 100;
      if (Math.abs(candidate - value) <= SNAP_TOLERANCE) return candidate;
    }
  }
  return Math.round(value * 100) / 100;
}

function isStandardEdition(o: NexardaOffer): boolean {
  return /^standard\b/i.test(o.edition ?? '');
}

/**
 * Pick the offer to quote.
 *
 * A game lists one offer per edition (Standard / Deluxe / Day One …). Quoting
 * the cheapest outright would price a stripped edition against the base game's
 * store page, so Standard wins when present; otherwise the cheapest listing is
 * the closest thing to a base price.
 */
function pickOffer(offers: NexardaOffer[]): NexardaOffer | null {
  const usable = offers.filter(
    (o) =>
      o.store?.name === PSN_STORE_NAME &&
      o.available !== false &&
      typeof o.price === 'number' &&
      Number.isFinite(o.price),
  );
  if (!usable.length) return null;

  const standard = usable.filter(isStandardEdition);
  const pool = standard.length ? standard : usable;
  return pool.reduce((best, o) => ((o.price ?? Infinity) < (best.price ?? Infinity) ? o : best));
}

/**
 * Current PlayStation Store price for a game title.
 * Returns null when not found or the payload has no usable price.
 */
export async function getPsnPrice(title: string, country = 'US'): Promise<PsnPrice | null> {
  try {
    const gameId = await lookupNexardaGameId(title);
    if (gameId == null) return null;

    const url = new URL(`${NEXARDA_BASE}/prices`);
    url.searchParams.set('type', 'game');
    url.searchParams.set('id', String(gameId));
    url.searchParams.set('currency', currencyFor(country));

    const json = (await getJson(url.toString())) as NexardaPricesResponse | null;
    const offers = json?.prices?.list;
    if (!Array.isArray(offers)) {
      console.warn(`[NEXARDA] no offer list for "${title}" (id ${gameId})`);
      return null;
    }

    const offer = pickOffer(offers);
    if (!offer || typeof offer.price !== 'number') {
      console.warn(`[NEXARDA] no PlayStation Store offer for "${title}" (id ${gameId})`);
      return null;
    }

    const price = offer.price;

    // `discount` is the only signal for the undiscounted price — NEXARDA sends
    // no list price. It is also incomplete: some genuinely discounted offers
    // report discount 0, which renders as "not on sale". Understating a sale is
    // the safe failure; deriving `regular` from other offers' prices would
    // invent one. Back-computing can land a cent off ($29.98 for a $29.99
    // list), so `cut` is taken from upstream rather than recomputed from it.
    const rawCut = Number(offer.discount);
    const cut = Number.isFinite(rawCut) && rawCut > 0 && rawCut < 100 ? Math.round(rawCut) : 0;
    const regular = cut > 0 ? snapToListPrice(price / (1 - cut / 100)) : price;

    return {
      price,
      regular,
      cut,
      // Affiliate redirect — NEXARDA's terms require passing it through as-is.
      url: offer.url ?? `https://store.playstation.com/search/${encodeURIComponent(title)}`,
      shop: PSN_STORE_NAME,
    };
  } catch (err) {
    console.warn(`[NEXARDA] error for "${title}":`, err);
    return null;
  }
}
