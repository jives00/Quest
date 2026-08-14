// ---------------------------------------------------------------------------
// Steam Store client — no API key required
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SteamAppDetails {
  /** Store name of the app, null when unavailable. */
  name: string | null;
  /** 'full' | 'partial' | '' mapped from the raw string */
  controllerSupport: 'none' | 'partial' | 'full' | null;
  /** Metacritic score 0-100, null when not present */
  metacritic: number | null;
  /** URL to the Metacritic page, e.g. "https://www.metacritic.com/game/pc/..." */
  metacriticUrl: string | null;
  /** True when the Steam store lists this app as VR Supported or VR Only. */
  vrSupported: boolean;
  /** True when the store still lists this app as "Coming soon" (not yet released). */
  comingSoon: boolean;
  /** Raw store release-date string, e.g. "TBA", "Q3 2026", "12 Nov, 2025". */
  releaseDate: string | null;
}

export interface SteamTopSellerItem {
  appId: number;
  name: string;
  headerImage: string;
  finalPrice: number | null;
  originalPrice: number | null;
  discountPct: number;
  currency: string;
}

export interface SteamReviewSummary {
  /** Human-readable description e.g. "Very Positive" */
  desc: string;
  /** Percentage of positive reviews (0-100) */
  pct: number;
  /** Total review count */
  count: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type AppDetailsResponse = Record<
  string,
  {
    success: boolean;
    data?: {
      name?: string;
      controller_support?: string;
      metacritic?: {
        score: number;
        url: string;
      };
      categories?: Array<{ id: number; description: string }>;
      release_date?: { coming_soon?: boolean; date?: string };
    };
  }
>;

interface ReviewSummary {
  review_score_desc: string;
  total_reviews: number;
  total_positive: number;
}

interface AppReviewsResponse {
  success: number;
  query_summary: ReviewSummary;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Fetch the current Steam top sellers from the featured categories endpoint.
 * Returns an empty array on failure — no key required.
 */
export async function fetchTopSellers(): Promise<SteamTopSellerItem[]> {
  try {
    const res = await fetch('https://store.steampowered.com/api/featuredcategories?cc=US&l=en');
    if (!res.ok) return [];

    const json = (await res.json()) as {
      top_sellers?: {
        items?: Array<{
          id: number;
          name: string;
          header_image?: string;
          large_capsule_image?: string;
          final_price?: number;
          original_price?: number;
          discount_percent?: number;
          currency?: string;
        }>;
      };
    };

    const items = json.top_sellers?.items ?? [];
    return items.map(item => ({
      appId: item.id,
      name: item.name,
      headerImage: item.header_image ?? item.large_capsule_image ?? '',
      finalPrice: item.final_price ?? null,
      originalPrice: item.original_price ?? null,
      discountPct: item.discount_percent ?? 0,
      currency: item.currency ?? 'USD',
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch app details from the Steam storefront API.
 * Returns null on network/parse failure.
 */
export async function fetchAppDetails(appid: string | number): Promise<SteamAppDetails | null> {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic,metacritic,controller,categories,release_date`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const json = (await res.json()) as AppDetailsResponse;
    const entry = json[String(appid)];
    if (!entry?.success || !entry.data) return null;

    const d = entry.data;

    let controllerSupport: 'none' | 'partial' | 'full' | null = null;
    if (d.controller_support === 'full') controllerSupport = 'full';
    else if (d.controller_support === 'partial') controllerSupport = 'partial';
    else if (d.controller_support === 'none' || d.controller_support === '') controllerSupport = 'none';

    const vrSupported = d.categories?.some(c => /vr/i.test(c.description)) ?? false;

    return {
      name: d.name ?? null,
      controllerSupport,
      metacritic: d.metacritic?.score ?? null,
      metacriticUrl: d.metacritic?.url ?? null,
      vrSupported,
      comingSoon: d.release_date?.coming_soon === true,
      releaseDate: d.release_date?.date || null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the review summary from the Steam reviews API.
 * Returns null on network/parse failure.
 */
export async function fetchReviewSummary(appid: string | number): Promise<SteamReviewSummary | null> {
  try {
    const url = `https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const json = (await res.json()) as AppReviewsResponse;
    if (!json.success) return null;

    const qs = json.query_summary;
    if (!qs || !qs.total_reviews) return null;

    const pct = Math.round((qs.total_positive / qs.total_reviews) * 100);

    return {
      desc: qs.review_score_desc,
      pct,
      count: qs.total_reviews,
    };
  } catch {
    return null;
  }
}
