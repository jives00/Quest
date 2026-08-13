// ---------------------------------------------------------------------------
// Price sources — which storefront a game's price is quoted from.
//
// Deliberately coarser than `Platform`: Steam/Epic/GOG all price the same PC
// copy and are covered by one provider (ITAD), so they collapse into 'pc'.
// Consoles each need their own provider.
// ---------------------------------------------------------------------------

import type { Platform } from './platforms';

export type PriceSource = 'pc' | 'psn' | 'xbox' | 'meta';

export const ALL_PRICE_SOURCES: PriceSource[] = ['pc', 'psn', 'xbox', 'meta'];

/** Order used when a user has never saved a preference. */
export const DEFAULT_PRICE_PRIORITY: PriceSource[] = ['pc', 'psn', 'xbox', 'meta'];

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  pc: 'PC',
  psn: 'PlayStation',
  xbox: 'Xbox',
  meta: 'Meta Quest',
};

/** Provider backing each source, for display in settings. */
export const PRICE_SOURCE_PROVIDERS: Record<PriceSource, string> = {
  pc: 'IsThereAnyDeal',
  psn: 'not yet integrated',
  xbox: 'not yet integrated',
  meta: 'not yet integrated',
};

/**
 * Sources with a live price provider today. Everything else resolves normally
 * but reports `supported: false` so the UI can say why there is no price,
 * rather than silently falling back to a different store's price.
 */
export const IMPLEMENTED_PRICE_SOURCES: PriceSource[] = ['pc'];

export function isPriceSource(v: unknown): v is PriceSource {
  return typeof v === 'string' && (ALL_PRICE_SOURCES as string[]).includes(v);
}

/** Owned-platform → the source that prices it. */
export const PLATFORM_PRICE_SOURCE: Record<Platform, PriceSource> = {
  steam: 'pc',
  epic: 'pc',
  gog: 'pc',
  psn: 'psn',
  xbox: 'xbox',
  meta_quest: 'meta',
};

/**
 * Map an IGDB platform name (e.g. "PlayStation 5", "Meta Quest 3") to a source.
 * IGDB names are the only availability signal for a wishlisted game the user
 * does not own yet, so this drives which sources are even candidates.
 * Matching is substring-based because IGDB's naming varies by generation.
 */
export function priceSourceFromIgdbPlatform(name: string): PriceSource | null {
  const n = name.toLowerCase();
  // Check VR before PlayStation: "PlayStation VR2" is sold on the PS store, but
  // "Meta Quest" / "Oculus" are their own storefront.
  if (n.includes('quest') || n.includes('oculus') || n.includes('meta ')) return 'meta';
  if (n.includes('playstation') || n.startsWith('ps')) return 'psn';
  if (n.includes('xbox')) return 'xbox';
  if (n.includes('pc') || n.includes('windows') || n.includes('linux') || n.includes('mac')) {
    return 'pc';
  }
  return null;
}

/** Order `sources` by the user's priority list; unknown entries sort last. */
export function byPriority(priority: PriceSource[]) {
  return (a: PriceSource, b: PriceSource) => {
    const ai = priority.indexOf(a);
    const bi = priority.indexOf(b);
    return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
  };
}

/**
 * Normalize a stored/submitted order into a complete, duplicate-free list.
 * Missing sources are appended in default order so the list always covers
 * every source even after one is added to the codebase.
 */
export function normalizePriority(order: unknown): PriceSource[] {
  const input = Array.isArray(order) ? order.filter(isPriceSource) : [];
  const seen = new Set<PriceSource>();
  const out: PriceSource[] = [];
  for (const s of input) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  for (const s of DEFAULT_PRICE_PRIORITY) {
    if (!seen.has(s)) out.push(s);
  }
  return out;
}
