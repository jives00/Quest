// ---------------------------------------------------------------------------
// Deku Deals — physical (disc) pricing for console games.
//
// Sony's store only ever quotes the digital copy, so a wishlisted PS game that
// is $30 on a disc at Amazon showed as full price. Deku Deals tracks both, per
// retailer, and is the only free source that does.
//
// WHAT WE PARSE, AND WHY IT IS NOT MARKUP SCRAPING.
// Item pages carry two machine-readable payloads that exist for the site's own
// analytics and charting code:
//   - `outAnalytics['<retailer>:<sku>'] = {...}` — one per row of the current
//     price table, with platform, physical/digital, price in cents, and the
//     delta from MSRP.
//   - `<script id='price_history_data'>` — the full per-retailer history, with
//     headers like "Best Buy (PS5, physical)" naming platform AND format.
// Both are stable JSON. The rendered <table> markup is not parsed at all.
//
// THE SHARP EDGES.
//  1. Search only covers Nintendo unless `include[all_platforms]=true` is set,
//     and that parameter 403s without a `rack.session` cookie. So every search
//     is preceded by a cheap GET to mint one. robots.txt disallows `filter[*`
//     but not `include[*`, so this path is permitted.
//  2. Slugs cannot be guessed. "God of War Ragnarök" is `god-of-war-ragnark`,
//     NieR:Automata is `nierautomata`, and a wrong guess frequently lands on a
//     real DLC page — which would quote a $10 skin pack as the game. Titles are
//     resolved through search and verified by similarity, same as the ITAD path.
//  3. Retailer links are affiliate redirects (howl.me, bestbuycreators, an
//     Amazon tag). We deliberately link to the Deku Deals item page instead —
//     it lists every retailer anyway, and quietly routing through someone's
//     referral link is not this app's business.
//
// US only. Region is session-cookie state on their side, so a non-US country
// returns null rather than a silently-wrong-region price.
// ---------------------------------------------------------------------------

import { similarity } from './matching.service';

const BASE = 'https://www.dekudeals.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const REQUEST_SPACING_MS = 2_000; // no Crawl-delay published; this is us being polite
const TITLE_MATCH_THRESHOLD = 0.8; // same bar as the ITAD title lookup

export interface DekuPhysicalPrice {
  price: number;
  regular: number;
  cut: number;
  shop: string;
  url: string;
  /** Lowest price ever recorded on a PlayStation SKU, either format. */
  lowest: number | null;
}

// ---------------------------------------------------------------------------
// Transport — throttle + session cookie
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

/** The `rack.session` cookie the faceted search requires. Minted on demand. */
let sessionCookie: string | null = null;

async function request(path: string): Promise<string | null> {
  await throttle();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-US,en;q=0.9',
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
    },
  });

  // Their session cookie rotates; capture whatever comes back.
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    if (c.startsWith('rack.session=')) sessionCookie = c.split(';')[0];
  }

  if (!res.ok) {
    console.warn(`[DekuDeals] ${res.status} for ${path}`);
    return null;
  }
  return res.text();
}

/**
 * Mint a session cookie.
 *
 * It has to be a Rails-rendered page — the static assets (`/opensearch.xml`,
 * `/robots.txt`) never touch the session middleware and hand back nothing.
 * `/ccpa` is the smallest rendered page on the site at ~26KB.
 */
async function ensureSession(): Promise<void> {
  if (sessionCookie) return;
  await request('/ccpa');
}

// ---------------------------------------------------------------------------
// Title → slug
// ---------------------------------------------------------------------------

/** Resolved slugs, so the daily refresh sweep re-searches nothing. */
const slugCache = new Map<string, string | null>();

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

/**
 * Find the Deku Deals slug for a title.
 *
 * Rejects anything below the similarity bar: their search happily answers a
 * game with its own Deluxe Edition upgrade or a soundtrack, and pricing a
 * wishlisted game off a $10 DLC is worse than showing no price at all.
 */
export async function lookupDekuSlug(title: string): Promise<string | null> {
  const key = title.toLowerCase();
  const cached = slugCache.get(key);
  if (cached !== undefined) return cached;

  let slug: string | null = null;
  try {
    const path = `/search?q=${encodeURIComponent(title)}&include%5Ball_platforms%5D=true`;
    await ensureSession();
    let html = await request(path);
    // A 403 here means the session lapsed, since that is the only thing gating
    // the all-platforms facet. Mint a new one and give it exactly one retry.
    if (html == null && sessionCookie) {
      sessionCookie = null;
      await ensureSession();
      html = await request(path);
    }
    if (html) {
      // One <a class='main-link' href='/items/<slug>?...'> per result, wrapping
      // an <h6> with the display title.
      const results = [
        ...html.matchAll(
          /<a class='main-link[^']*' href='\/items\/([^'?]+)[^']*'>\s*<h6[^>]*>([^<]+)<\/h6>/g,
        ),
      ].map((m) => ({ slug: m[1], title: decodeEntities(m[2]).trim() }));

      let best = 0;
      for (const r of results) {
        const score = similarity(title, r.title);
        if (score > best) {
          best = score;
          slug = r.slug;
        }
      }
      if (best < TITLE_MATCH_THRESHOLD) {
        if (slug) {
          console.warn(
            `[DekuDeals] best match for "${title}" was "${slug}" (${best.toFixed(2)}) — rejecting`,
          );
        }
        slug = null;
      }
    }
  } catch (err) {
    console.error(`[DekuDeals] search failed for "${title}":`, err);
    return null; // not cached — a transient network failure should be retried
  }

  slugCache.set(key, slug);
  return slug;
}

// ---------------------------------------------------------------------------
// Item page parsing
// ---------------------------------------------------------------------------

interface OutAnalyticsRow {
  id: string;
  /** Retailer slug, e.g. `amazon`, `bestbuy`, `playstation_us`. */
  affiliation: string;
  /** Platform slug, e.g. `ps5`, `ps5+ps4`, `switch`, `xbox_series+xbox_one`. */
  category: string;
  variant: string;
  /** Cents. */
  price: number;
  /** Cents off MSRP. Negative when the listing is priced ABOVE MSRP. */
  discount: number;
}

function parseOutAnalytics(html: string): OutAnalyticsRow[] {
  const rows: OutAnalyticsRow[] = [];
  for (const m of html.matchAll(/outAnalytics\['([^']+)'\] = (\{.*\})/g)) {
    try {
      const payload = JSON.parse(m[2]) as {
        value?: number;
        items?: { affiliation?: string; item_category?: string; item_variant?: string; discount?: number }[];
      };
      const item = payload.items?.[0];
      if (!item) continue;
      rows.push({
        id: m[1],
        affiliation: item.affiliation ?? '',
        category: item.item_category ?? '',
        variant: item.item_variant ?? '',
        price: Number(payload.value ?? 0),
        discount: Number(item.discount ?? 0),
      });
    } catch {
      // A single malformed row must not lose the rest of the table.
    }
  }
  return rows;
}

/** True for `ps5`, `ps4`, `ps5+ps4` — but not `steam`, `switch`, `xbox_*`. */
function isPlaystationCategory(category: string): boolean {
  return category.split('+').some((p) => /^ps\d/.test(p.trim()));
}

/** Human retailer name from the row's logo alt text, else the slug tidied up. */
function retailerLabel(html: string, row: OutAnalyticsRow): string {
  const escaped = row.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = html.match(new RegExp(`data-out-analytics-id='${escaped}'[\\s\\S]{0,400}?<img alt='([^']+)'`));
  if (m) return decodeEntities(m[1]).replace(/\.com$/, '');
  return row.affiliation
    .split('_')[0]
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Lowest price ever recorded for this game on PlayStation, either format.
 *
 * The chart's series are named "<Retailer> (<Platform>, <format>)", or just
 * "<Retailer> (<format>)" when the game is single-platform. Filtering to the
 * PlayStation columns is what stops a Switch eShop sale being reported as the
 * all-time low of a PS5 game.
 *
 * Column mapping: `data` rows are [date, aggregate, ...headers], so header `i`
 * lives at column `i + 2`.
 */
function parsePlaystationLow(html: string, psOnlyItem: boolean): number | null {
  const m = html.match(
    /<script id='price_history_data' type='application\/json'>(.*?)<\/script>/s,
  );
  if (!m) return null;

  let parsed: { headers?: string[]; data?: (string | number | null)[][] };
  try {
    parsed = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const headers = parsed.headers ?? [];
  const data = parsed.data ?? [];
  if (!headers.length || !data.length) return null;

  const columns: number[] = [];
  headers.forEach((header, i) => {
    const paren = header.match(/\(([^)]*)\)\s*$/);
    const parts = paren ? paren[1].split(',').map((p) => p.trim()) : [];
    // Two parts means "<platform>, <format>"; one means format only, which the
    // site emits when every SKU on the page shares a platform.
    const platform = parts.length >= 2 ? parts[0].toLowerCase() : null;
    const isPs = platform ? /\bps\d|playstation/.test(platform) : psOnlyItem;
    if (isPs) columns.push(i + 2);
  });
  if (!columns.length) return null;

  let low: number | null = null;
  for (const row of data) {
    for (const col of columns) {
      const v = row[col];
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
      if (low == null || v < low) low = v;
    }
  }
  return low;
}

/**
 * Cheapest in-stock physical PlayStation copy, plus the all-time PS low.
 *
 * Returns null when the game has no PlayStation disc listing — which is the
 * normal answer for a digital-only or non-PlayStation title, not an error.
 */
export async function getDekuPhysicalPsPrice(
  title: string,
  country = 'US',
): Promise<DekuPhysicalPrice | null> {
  if (country.toUpperCase() !== 'US') return null;

  try {
    const slug = await lookupDekuSlug(title);
    if (!slug) return null;

    // `?platform=all` is load-bearing. A bare item URL renders only one
    // platform's tab — Switch, for anything Nintendo also sells — and the
    // PlayStation rows are absent from the payload entirely rather than
    // present-and-empty. Without it, every cross-platform game silently
    // reports no disc price.
    const html = await request(`/items/${slug}?platform=all`);
    if (!html) return null;

    const rows = parseOutAnalytics(html);
    if (!rows.length) return null;

    // `value: 0` is how an out-of-stock listing is rendered ("Unavailable").
    const physical = rows.filter(
      (r) => r.variant === 'physical' && isPlaystationCategory(r.category) && r.price > 0,
    );
    if (!physical.length) return null;

    const best = physical.reduce((a, b) => (b.price < a.price ? b : a));

    const price = best.price / 100;
    // discount is MSRP − price in cents, so it goes negative on a marked-up
    // listing (a scarce disc above list). Never render that as a "discount".
    const regular = Math.max(price, (best.price + best.discount) / 100);
    const cut = regular > price ? Math.round(((regular - price) / regular) * 100) : 0;

    const psOnlyItem = rows.every((r) => isPlaystationCategory(r.category));
    const historyLow = parsePlaystationLow(html, psOnlyItem);
    // History can lag today's listings; an "all-time low" above the price on
    // screen would be nonsense, so let the live price win.
    const lowest = historyLow != null ? Math.min(historyLow, price) : null;

    return {
      price,
      regular,
      cut,
      shop: `${retailerLabel(html, best)} (physical)`,
      url: `${BASE}/items/${slug}`,
      lowest,
    };
  } catch (err) {
    console.error(`[DekuDeals] price lookup failed for "${title}":`, err);
    return null;
  }
}
