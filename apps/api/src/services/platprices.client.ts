// ---------------------------------------------------------------------------
// PlatPrices — PlayStation Store pricing. Optional, key-gated.
// Register a free key at https://platprices.com/developers.php
//
// Free tier is 1,000 requests/month, which is only viable because prices are
// served from the game_prices cache and refreshed on a 24h TTL.
//
// Lookup is by fuzzy NAME, not id: PSN concept ids only ever land on games the
// PSN poller has seen *played*, and a wishlisted game has never been played —
// all 52 wishlisted PlayStation titles carry zero psn_concept ids. `psnid`
// takes a CUSA/PPSA anyway, which is a different identifier entirely.
//
// v1 (/api.php) retires 2026-12-01; this targets v2.
// ---------------------------------------------------------------------------

const PLATPRICES_BASE = 'https://platprices.com/api/v2';

export interface PsnPrice {
  price: number;
  regular: number;
  cut: number;
  shop: string;
  url: string;
}

/** Returns true when PLATPRICES_API_KEY is configured. */
export function isPlatPricesEnabled(): boolean {
  return Boolean(process.env.PLATPRICES_API_KEY);
}

interface PlatPricesEnvelope {
  success?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string; status?: number } | null;
}

/**
 * Money fields come back both as raw numbers (documented as cents) and as
 * preformatted strings. Prefer the formatted string: it is unambiguous, so a
 * cents-vs-dollars mix-up cannot silently render a price 100x off.
 */
function parseMoney(formatted: unknown, raw: unknown): number | null {
  if (typeof formatted === 'string') {
    const n = Number(formatted.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw / 100;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n / 100;
  }
  return null;
}

function firstRecord(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const hit = data.find((d) => d && typeof d === 'object');
    return (hit as Record<string, unknown>) ?? null;
  }
  if (data && typeof data === 'object') {
    // Some endpoints nest the list under `games`/`results`.
    const obj = data as Record<string, unknown>;
    for (const key of ['games', 'results', 'items']) {
      if (Array.isArray(obj[key])) return firstRecord(obj[key]);
    }
    return obj;
  }
  return null;
}

/**
 * Current PlayStation Store price for a game title.
 * Returns null when disabled, not found, or the payload has no usable price.
 */
export async function getPsnPrice(title: string, region = 'US'): Promise<PsnPrice | null> {
  if (!isPlatPricesEnabled()) return null;

  try {
    const url = new URL(`${PLATPRICES_BASE}/games`);
    url.searchParams.set('name', title);
    url.searchParams.set('region', region.toLowerCase());

    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': process.env.PLATPRICES_API_KEY ?? '' },
    });

    if (res.status === 429) {
      console.warn('[PlatPrices] rate limited — monthly quota may be exhausted');
      return null;
    }
    if (!res.ok) {
      console.warn(`[PlatPrices] lookup failed for "${title}": HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as PlatPricesEnvelope;
    if (json.success === false) {
      console.warn(`[PlatPrices] "${title}": ${json.error?.code ?? 'error'} — ${json.error?.message ?? ''}`);
      return null;
    }

    const game = firstRecord(json.data);
    if (!game) {
      console.warn(`[PlatPrices] no match for "${title}"`);
      return null;
    }

    const base = parseMoney(game.formattedBasePrice, game.BasePrice);
    const sale = parseMoney(game.formattedSalePrice, game.SalePrice);

    // SalePrice is the live price; BasePrice is the undiscounted one. When a
    // game is not on sale the two are equal, which yields cut 0.
    const price = sale ?? base;
    if (price == null) {
      console.warn(`[PlatPrices] no usable price for "${title}"`);
      return null;
    }
    const regular = base != null && base > price ? base : price;

    const rawCut = Number(game.DiscPerc);
    const cut =
      Number.isFinite(rawCut) && rawCut > 0
        ? Math.round(rawCut)
        : regular > price
          ? Math.round(((regular - price) / regular) * 100)
          : 0;

    const link =
      typeof game.URL === 'string'
        ? game.URL
        : typeof game.PSStoreURL === 'string'
          ? game.PSStoreURL
          : `https://store.playstation.com/search/${encodeURIComponent(title)}`;

    return { price, regular, cut, shop: 'PlayStation Store', url: link };
  } catch (err) {
    console.warn(`[PlatPrices] error for "${title}":`, err);
    return null;
  }
}
