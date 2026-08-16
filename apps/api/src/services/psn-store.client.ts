// ---------------------------------------------------------------------------
// PlayStation Store pricing, straight from Sony's own storefront GraphQL.
//
// Primary `psn` provider. Free, unauthenticated, and authoritative — it is the
// same endpoint store.playstation.com calls, so list price and discount are
// exact rather than derived. NEXARDA remains the fallback (see nexarda.client)
// because this API has one sharp edge, below.
//
// THE SHARP EDGE — persisted queries only.
// The endpoint refuses freeform GraphQL (`PERSISTED_QUERY_ID_REQUIRED`) and
// refuses to register new ones (`CANNOT_SEND_PQ_ID_AND_BODY`). Operations must
// be sent as a sha256 id Sony has pre-registered at their edge. The id is a
// hash of the exact query document their web client ships, so it changes
// whenever Sony edits that document, and there is no way to compute it from
// the outside — the query text in their JS bundles does not reproduce it
// (Apollo hashes a transformed document; several reconstructions all missed).
//
// TO RE-CAPTURE when SEARCH_QUERY_HASH goes stale:
//   1. Visit https://store.playstation.com/en-us/pages/browse
//   2. Search for anything using the store's own search box
//   3. In the DevTools console, run:
//        performance.getEntriesByType('resource').map(e => e.name)
//          .filter(n => n.includes('graphql')).join('\n')
//   4. Copy sha256Hash out of the getSearchResults URL's `extensions` param
// A stale hash returns `{"message":"Query <hash> not whitelisted"}`, which is
// logged loudly and degrades to NEXARDA rather than dropping prices to zero.
// ---------------------------------------------------------------------------

// Note the doubled slash before `op` — that is what the store client sends.
const PSN_GRAPHQL = 'https://web.np.playstation.com/api/graphql/v1//op';

/** Captured 2026-08-16 from store.playstation.com. See re-capture steps above. */
const SEARCH_QUERY_HASH = '4df6284f982e57bec70f23c77e2c219dc792eb19af7fb3d3a81767aa3f1958aa';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGE_SIZE = 20;
const REQUEST_SPACING_MS = 500;

export interface PsnPrice {
  price: number;
  regular: number;
  cut: number;
  shop: string;
  url: string;
}

/** Sony needs no credentials, so this provider is always available. */
export function isPsnStoreEnabled(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Product classification
// ---------------------------------------------------------------------------

/**
 * Which store listings can stand in for "the game", best first.
 *
 * A search for one title returns its DLC, costume packs and edition upgrades
 * too — pricing a wishlisted game off its $0.99 cosmetic pack would be worse
 * than showing nothing. Anything not listed here is discarded.
 *
 * PREMIUM_EDITION is last but still allowed: some games no longer sell a
 * standard edition at all (Ghost of Yotei only lists a Complete Edition), so
 * excluding it would lose the price entirely.
 */
const CLASSIFICATION_RANK: Record<string, number> = {
  FULL_GAME: 0,
  GAME_BUNDLE: 1,
  PREMIUM_EDITION: 2,
};

/**
 * Fold a store title down to something comparable with a library title.
 * Strips trademark symbols and diacritics — Sony writes "Ghost of Yōtei™"
 * where IGDB writes "Ghost of Yotei".
 *
 * NFD, not NFKD: compatibility decomposition expands "™" to the letters "TM",
 * which turned "HELLDIVERS™ 2" into "helldiverstm 2" and lost the match.
 */
function normalizeTitle(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Parse a preformatted store price ("$69.99", "24,99 €").
 * Sony returns money only as display strings on this operation, so there is no
 * raw minor-unit field to prefer.
 */
function parseMoney(formatted: unknown): number | null {
  if (typeof formatted !== 'string') return null;
  const digits = formatted.replace(/[^0-9.,]/g, '');
  if (!digits) return null;

  // Whichever separator comes last is the decimal one; the other groups
  // thousands. "1.234,56" and "1,234.56" both have to land on 1234.56.
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    normalized =
      lastComma > lastDot
        ? digits.replace(/\./g, '').replace(',', '.')
        : digits.replace(/,/g, '');
  } else {
    normalized = digits.replace(',', '.');
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

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

interface SkuPrice {
  basePrice?: string | null;
  discountedPrice?: string | null;
  discountText?: string | null;
  isFree?: boolean;
}

interface SearchResult {
  __typename?: string;
  id?: string;
  name?: string;
  storeDisplayClassification?: string | null;
  price?: SkuPrice | null;
}

/**
 * Run the store's own search operation.
 * Returns null on any failure; a stale persisted-query hash is called out
 * separately because it needs a human to re-capture it.
 */
async function search(term: string, country: string): Promise<SearchResult[] | null> {
  await throttle();

  const url = new URL(PSN_GRAPHQL);
  url.searchParams.set('operationName', 'getSearchResults');
  url.searchParams.set(
    'variables',
    JSON.stringify({
      countryCode: country.toUpperCase(),
      languageCode: 'en',
      nextCursor: '',
      pageOffset: 0,
      pageSize: PAGE_SIZE,
      searchTerm: term,
    }),
  );
  url.searchParams.set(
    'extensions',
    JSON.stringify({ persistedQuery: { version: 1, sha256Hash: SEARCH_QUERY_HASH } }),
  );

  const res = await fetch(url.toString(), {
    headers: {
      // Required: without a JSON content-type the endpoint rejects the request
      // as a potential CSRF, even for a plain GET.
      'content-type': 'application/json',
      'x-psn-store-locale-override': `en-${country.toUpperCase()}`,
      'User-Agent': UA,
    },
  });

  const body = (await res.json()) as {
    message?: string;
    data?: { universalSearch?: { results?: SearchResult[] } | null } | null;
  };

  if (typeof body.message === 'string' && body.message.includes('not whitelisted')) {
    console.error(
      `[PSN] persisted query hash rejected — Sony rotated it. Re-capture ` +
        `SEARCH_QUERY_HASH (see psn-store.client.ts); falling back to NEXARDA.`,
    );
    return null;
  }
  if (!res.ok) {
    console.warn(`[PSN] search failed for "${term}": HTTP ${res.status}`);
    return null;
  }

  const results = body.data?.universalSearch?.results;
  return Array.isArray(results) ? results : null;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Pick the listing that is actually the requested game.
 *
 * Deliberately strict: a search for "Ghost of Yotei" ranks "Ghostbusters:
 * Rise of the Ghost Lord" fifth, so taking the first sellable result would
 * confidently price the wrong game. Exact name match wins; a prefix match is
 * the loosest thing accepted, and nothing else matches at all.
 */
function pickListing(results: SearchResult[], title: string): SearchResult | null {
  const want = normalizeTitle(title);

  const sellable = results
    .filter(
      (r) =>
        r.__typename === 'Product' &&
        typeof r.id === 'string' &&
        typeof r.name === 'string' &&
        r.storeDisplayClassification != null &&
        r.storeDisplayClassification in CLASSIFICATION_RANK,
    )
    .map((r) => ({ r, name: normalizeTitle(r.name as string) }));

  if (!sellable.length) return null;

  const rank = (r: SearchResult) => CLASSIFICATION_RANK[r.storeDisplayClassification as string];
  const best = (pool: typeof sellable) =>
    pool.reduce((a, b) => (rank(b.r) < rank(a.r) ? b : a)).r;

  const exact = sellable.filter((s) => s.name === want);
  if (exact.length) return best(exact);

  // "Foo" vs "Foo Complete Edition" — accept, but nothing looser.
  const prefix = sellable.filter((s) => s.name.startsWith(want) || want.startsWith(s.name));
  if (prefix.length) return best(prefix);

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Current PlayStation Store price for a game title.
 * Returns null when the hash is stale, the title does not match a listing, or
 * the listing carries no usable price — all of which the caller treats as
 * "ask the fallback provider".
 */
export async function getPsnStorePrice(title: string, country = 'US'): Promise<PsnPrice | null> {
  try {
    const results = await search(title, country);
    if (!results) return null;

    const listing = pickListing(results, title);
    if (!listing) {
      console.warn(`[PSN] no store listing matched "${title}"`);
      return null;
    }

    const p = listing.price;
    if (!p) {
      console.warn(`[PSN] listing for "${title}" carries no price`);
      return null;
    }

    const base = parseMoney(p.basePrice);
    const discounted = parseMoney(p.discountedPrice);
    const price = p.isFree ? 0 : (discounted ?? base);
    if (price == null) {
      console.warn(`[PSN] no usable price for "${title}"`);
      return null;
    }
    const regular = base != null && base > price ? base : price;

    // discountText is the store's own "-25%" label. Trust it over arithmetic:
    // it is what the storefront shows the user.
    const labelled = Number(/-?(\d+)\s*%/.exec(p.discountText ?? '')?.[1]);
    const cut = Number.isFinite(labelled)
      ? labelled
      : regular > price
        ? Math.round(((regular - price) / regular) * 100)
        : 0;

    return {
      price,
      regular,
      cut,
      shop: 'PlayStation Store',
      url: `https://store.playstation.com/en-${country.toLowerCase()}/product/${listing.id}`,
    };
  } catch (err) {
    console.warn(`[PSN] error for "${title}":`, err);
    return null;
  }
}
