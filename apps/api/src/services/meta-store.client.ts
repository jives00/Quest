// ---------------------------------------------------------------------------
// Meta Quest store pricing.
//
// Two upstreams, because neither does the whole job:
//   - OculusDB resolves a title to a Meta app id. Its own prices are EUR-only
//     (?currency=USD is ignored), so we take nothing but the id from it.
//   - queststoredb.com renders schema.org JSON-LD with one Offer per currency,
//     including USD, plus a StrikethroughPrice for the pre-sale price.
//
// FX-converting OculusDB's EUR was rejected deliberately: Meta's regional
// pricing is not rate-linked. One sampled title is EUR 17.99 / USD 19.99, so a
// converted figure would be confidently wrong.
//
// queststoredb has no documented API. JSON-LD is the stable part of the page
// (schema.org contract, machine-readable by design), so we parse that rather
// than scraping markup. robots.txt allows crawling with Crawl-delay: 10, which
// REQUEST_SPACING_MS honors.
// ---------------------------------------------------------------------------

const OCULUSDB_BASE = 'https://oculusdb.rui2015.me';
const QUESTSTOREDB_BASE = 'https://queststoredb.com';
const UA = 'Quest-Tracker/1.0 (personal game library tracker)';
const REQUEST_SPACING_MS = 10_000; // queststoredb robots.txt Crawl-delay

export interface MetaPrice {
  price: number;
  regular: number;
  cut: number;
  shop: string;
  url: string;
}

// Module-level gate so concurrent callers still queue behind the crawl delay.
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

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface OculusDbEntry {
  id?: string;
  appName?: string;
  __OculusDBType?: string;
  /** Headset codenames the app supports. RIFT/LAGUNA mean the PC-VR listing. */
  supported_hmd_platforms?: string[];
}

/**
 * PC-VR headsets. An entry supporting these is the Rift-store listing, which
 * queststoredb does not cover (it 404s) - Beat Saber has one id for Rift and a
 * separate id for the standalone Quest store.
 */
const PCVR_HMDS = new Set(['RIFT', 'LAGUNA']);

function isQuestListing(e: OculusDbEntry): boolean {
  const hmds = e.supported_hmd_platforms;
  if (!Array.isArray(hmds) || !hmds.length) return true; // unknown - let it try
  return !hmds.some((h) => PCVR_HMDS.has(h));
}

/**
 * Resolve a game title to a Meta store app id via OculusDB.
 * Returns null when nothing matches closely enough — a loose match here would
 * price the wrong game, which is worse than showing no price.
 */
export async function lookupMetaAppId(title: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${OCULUSDB_BASE}/api/v1/search/${encodeURIComponent(title)}`,
      { headers: { 'User-Agent': UA } },
    );
    if (!res.ok) {
      console.warn(`[Meta] OculusDB search failed: HTTP ${res.status}`);
      return null;
    }

    const entries = (await res.json()) as OculusDbEntry[];
    if (!Array.isArray(entries) || !entries.length) return null;

    const want = normalizeTitle(title);
    const apps = entries.filter(
      (e) => e.__OculusDBType === 'Application' && e.id && isQuestListing(e),
    );

    const exact = apps.find((e) => normalizeTitle(e.appName ?? '') === want);
    if (exact?.id) return exact.id;

    // Accept a prefix match ("Foo" vs "Foo VR") but nothing looser.
    const prefix = apps.find((e) => {
      const got = normalizeTitle(e.appName ?? '');
      return got.startsWith(want) || want.startsWith(got);
    });
    return prefix?.id ?? null;
  } catch (err) {
    console.warn('[Meta] OculusDB search error:', err);
    return null;
  }
}

interface LdOffer {
  priceCurrency?: string;
  price?: number;
  url?: string;
  priceSpecification?: { price?: number; priceType?: string } | null;
}

/**
 * Fetch the current USD price for a Meta app id.
 *
 * The slug in queststoredb's URL is cosmetic — a wrong one 301s to the
 * canonical page — so the id alone is a stable entry point.
 */
export async function getMetaPrice(appId: string): Promise<MetaPrice | null> {
  try {
    await throttle();
    const res = await fetch(`${QUESTSTOREDB_BASE}/game/x-${encodeURIComponent(appId)}/`, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
    });
    if (!res.ok) {
      console.warn(`[Meta] queststoredb ${appId}: HTTP ${res.status}`);
      return null;
    }

    const html = await res.text();
    const match = html.match(
      /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (!match) {
      console.warn(`[Meta] no JSON-LD for app ${appId}`);
      return null;
    }

    const data = JSON.parse(match[1]) as { '@graph'?: { offers?: LdOffer[] }[] };
    const node = data['@graph']?.find((n) => Array.isArray(n.offers));
    const usd = node?.offers?.find((o) => o.priceCurrency === 'USD');
    if (!usd || typeof usd.price !== 'number') {
      console.warn(`[Meta] no USD offer for app ${appId}`);
      return null;
    }

    const price = usd.price;
    const strike =
      usd.priceSpecification?.priceType?.includes('StrikethroughPrice') &&
      typeof usd.priceSpecification.price === 'number'
        ? usd.priceSpecification.price
        : null;
    const regular = strike != null && strike > price ? strike : price;
    const cut = regular > price ? Math.round(((regular - price) / regular) * 100) : 0;

    return {
      price,
      regular,
      cut,
      shop: 'Meta Quest Store',
      url: usd.url ?? `https://www.meta.com/experiences/${appId}/`,
    };
  } catch (err) {
    console.warn(`[Meta] price fetch error for app ${appId}:`, err);
    return null;
  }
}
