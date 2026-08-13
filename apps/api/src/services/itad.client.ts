// ---------------------------------------------------------------------------
// IsThereAnyDeal (ITAD) client — optional, key-gated
// Register a free key at https://isthereanydeal.com/dev/app/
// ---------------------------------------------------------------------------

const ITAD_BASE = 'https://api.isthereanydeal.com';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ItadDealEntry {
  /** Price in the requested currency */
  price: number;
  /** Undiscounted price in the requested currency */
  regular: number;
  /** Discount percentage off the regular price (0 when not on sale) */
  cut: number;
  /** Human-readable shop name */
  shop: string;
  /** Direct URL to the deal */
  url: string;
}

export interface ItadPriceOverview {
  /** Current best price available */
  current: ItadDealEntry | null;
  /** Historical lowest price */
  lowest: { price: number } | null;
}

// ---------------------------------------------------------------------------
// Enable guard
// ---------------------------------------------------------------------------

/**
 * Returns true when ITAD_API_KEY is configured.
 * The matching service calls this before using ITAD, so the key is optional.
 */
export function isItadEnabled(): boolean {
  return Boolean(process.env.ITAD_API_KEY);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ItadLookupResponse {
  game?: {
    id: string;
    slug: string;
    title: string;
  };
}

interface ItadDeal {
  shop: { name: string };
  price: { amount: number; currency: string };
  /** Undiscounted price. Absent for some shops. */
  regular?: { amount: number; currency: string } | null;
  /** Discount percentage. Absent for some shops. */
  cut?: number | null;
  url: string;
}

interface ItadOverviewItem {
  id: string;
  /** Current best deal (null when not currently sold). */
  current?: ItadDeal | null;
  /** Historical low price. */
  lowest?: { price: { amount: number } } | null;
}

/** POST /games/overview/v2 returns { prices: [...], bundles: [...] }. */
interface ItadOverviewResponse {
  prices?: ItadOverviewItem[];
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Look up an ITAD game ID by Steam appid (preferred) or title fallback.
 * Returns null when ITAD is disabled or nothing is found.
 */
export async function lookupGameId(opts: {
  appid?: string | number;
  title?: string;
}): Promise<string | null> {
  if (!isItadEnabled()) return null;
  const key = process.env.ITAD_API_KEY ?? '';

  try {
    const url = new URL(`${ITAD_BASE}/games/lookup/v1`);
    url.searchParams.set('key', key);
    if (opts.appid) {
      url.searchParams.set('appid', String(opts.appid));
    } else if (opts.title) {
      url.searchParams.set('title', opts.title);
    } else {
      return null;
    }

    const res = await fetch(url.toString());
    if (!res.ok) {
      console.warn(`[ITAD] lookup failed: HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as ItadLookupResponse;
    return json.game?.id ?? null;
  } catch (err) {
    console.warn('[ITAD] lookup error:', err);
    return null;
  }
}

/**
 * Get a price overview for an ITAD game ID.
 * Returns null when ITAD is disabled or on failure.
 */
export async function getPriceOverview(
  itadId: string,
  country = 'US',
): Promise<ItadPriceOverview | null> {
  if (!isItadEnabled()) return null;
  const key = process.env.ITAD_API_KEY ?? '';

  try {
    const url = new URL(`${ITAD_BASE}/games/overview/v2`);
    url.searchParams.set('key', key);
    url.searchParams.set('country', country);

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([itadId]),
    });
    if (!res.ok) {
      console.warn(`[ITAD] overview failed: HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as ItadOverviewResponse;
    const item = json.prices?.find((i) => i.id === itadId) ?? null;
    if (!item) {
      console.warn(`[ITAD] overview: itadId ${itadId} not in response`);
      return null;
    }

    let current: ItadDealEntry | null = null;
    if (item.current) {
      const price = item.current.price.amount;
      const regular = item.current.regular?.amount ?? price;
      // ITAD omits `cut` for some shops — derive it from regular vs. current.
      const cut =
        item.current.cut != null
          ? item.current.cut
          : regular > 0
            ? Math.round(((regular - price) / regular) * 100)
            : 0;
      current = {
        price,
        regular,
        cut: cut > 0 ? cut : 0,
        shop: item.current.shop.name,
        url: item.current.url,
      };
    }

    const lowest: { price: number } | null = item.lowest
      ? { price: item.lowest.price.amount }
      : null;

    return { current, lowest };
  } catch (err) {
    console.warn('[ITAD] overview error:', err);
    return null;
  }
}
