"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, type LibraryGame, type WishlistPrice } from "@/lib/api";
import { saveGameNavContext } from "@/lib/game-nav-context";

export const dynamic = "force-dynamic";

type SortKey = "alpha" | "release" | "rating" | "price" | "discount";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "alpha", label: "A–Z" },
  { key: "release", label: "Release" },
  { key: "rating", label: "Rating" },
  { key: "price", label: "Price" },
  { key: "discount", label: "Discount" },
];

const PILL_BASE =
  "px-[18px] py-[10px] rounded-full text-[15px] font-semibold border transition-colors";
const PILL_ACTIVE = "bg-accent text-on-primary border-accent";
const PILL_INACTIVE =
  "bg-surface-container text-on-surface/60 border-outline-variant/60 hover:text-on-surface";

const PREFS_KEY = "questWishlistPrefs";

interface WishlistPrefs {
  sort: SortKey;
  dir: SortDir;
  dealsOnly: boolean;
  grouped: boolean;
}

/** Read the saved control state, ignoring anything malformed or stale. */
function loadPrefs(): Partial<WishlistPrefs> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Partial<WishlistPrefs>;
    return {
      sort: SORT_OPTIONS.some((o) => o.key === p.sort) ? p.sort : undefined,
      dir: p.dir === "asc" || p.dir === "desc" ? p.dir : undefined,
      dealsOnly: typeof p.dealsOnly === "boolean" ? p.dealsOnly : undefined,
      grouped: typeof p.grouped === "boolean" ? p.grouped : undefined,
    };
  } catch {
    return {};
  }
}

interface WishlistEntry {
  game: LibraryGame;
  price: WishlistPrice | null;
  priceLoading: boolean;
}

/**
 * Sort weight for the discount column: negated cut so a bigger discount sorts
 * first, 0 for full-price games, and null (always last) when there is no price.
 */
function discountRank(e: WishlistEntry): number | null {
  const current = e.price?.current ?? null;
  if (current == null) return null;
  return current.cut > 0 ? -current.cut : 0;
}

/** Chip colors for the Metacritic band. */
function metacriticChip(mc: number | null | undefined) {
  if (mc == null) {
    return { value: "—", className: "bg-on-surface/[0.08] text-on-surface/40" };
  }
  if (mc >= 75) return { value: String(mc), className: "bg-accent/[0.18] text-accent-light" };
  if (mc >= 50) return { value: String(mc), className: "bg-yellow-400/[0.16] text-yellow-400" };
  return { value: String(mc), className: "bg-red-400/[0.16] text-red-400" };
}

export default function WishlistPage() {
  const router = useRouter();
  const { token, isLoading } = useAuth();
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>("price");
  const [dir, setDir] = useState<SortDir>("asc");
  const [dealsOnly, setDealsOnly] = useState(false);
  const [grouped, setGrouped] = useState(true);
  // Prefs live in localStorage, but they can only be read after mount — reading
  // during render would diverge from the server-rendered defaults. This must be
  // state, not a ref: a ref flips synchronously, so the save effect below would
  // still see the defaults in its closure and write them back over the stored
  // prefs before the loaded values ever reach state.
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  useEffect(() => {
    const p = loadPrefs();
    if (p.sort !== undefined) setSort(p.sort);
    if (p.dir !== undefined) setDir(p.dir);
    if (p.dealsOnly !== undefined) setDealsOnly(p.dealsOnly);
    if (p.grouped !== undefined) setGrouped(p.grouped);
    setPrefsLoaded(true);
  }, []);

  useEffect(() => {
    // Skip until the stored prefs have been applied, so the defaults never
    // overwrite them.
    if (!prefsLoaded) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sort, dir, dealsOnly, grouped }));
    } catch {}
  }, [prefsLoaded, sort, dir, dealsOnly, grouped]);

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api.getLists(token)
      .then(async (lists) => {
        const wishlist = lists.find((l) => l.systemKey === "wishlist");
        if (!wishlist) {
          setEntries([]);
          return;
        }
        const detail = await api.getListDetail(wishlist.id, token);
        const games = detail.games;
        // Render games immediately with price placeholders, then fill prices in as they arrive.
        setEntries(games.map((g) => ({ game: g, price: null, priceLoading: true })));
        for (const g of games) {
          api.getWishlistPrice(g.id, token)
            .then((price) => {
              setEntries((prev) =>
                prev.map((e) => (e.game.id === g.id ? { ...e, price, priceLoading: false } : e))
              );
            })
            .catch(() => {
              setEntries((prev) =>
                prev.map((e) => (e.game.id === g.id ? { ...e, price: null, priceLoading: false } : e))
              );
            });
        }
      })
      .catch((err) => console.error("Wishlist load error:", err))
      .finally(() => setLoading(false));
  }, [token]);

  const visible = useMemo(() => {
    const filtered = dealsOnly
      ? entries.filter((e) => {
          const current = e.price?.current?.price ?? null;
          const low = e.price?.lowest?.price ?? null;
          return current != null && low != null && current <= low * 1.1;
        })
      : entries;

    const mul = dir === "asc" ? 1 : -1;
    // Null values (no price / score / release date) always sort last, either direction.
    const cmp = (a: number | null, b: number | null) => {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      return (a - b) * mul;
    };

    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "alpha":
          return a.game.title.localeCompare(b.game.title) * mul;
        case "release":
          return cmp(
            a.game.firstReleaseDate ? +new Date(a.game.firstReleaseDate) : null,
            b.game.firstReleaseDate ? +new Date(b.game.firstReleaseDate) : null
          );
        case "rating":
          // Ascending = best rated first.
          return cmp(
            a.game.metacritic == null ? null : -a.game.metacritic,
            b.game.metacritic == null ? null : -b.game.metacritic
          );
        case "price":
          return cmp(a.price?.current?.price ?? null, b.price?.current?.price ?? null);
        case "discount":
          // Ascending = deepest discount first, then full price, then unpriced.
          return cmp(discountRank(a), discountRank(b));
      }
    });
  }, [entries, sort, dir, dealsOnly]);

  const groups = useMemo(() => {
    if (!grouped) return [{ label: "", showHeader: false, items: visible }];
    const now = Date.now();
    const isReleased = (e: WishlistEntry) =>
      e.game.firstReleaseDate != null && +new Date(e.game.firstReleaseDate) <= now;
    return [
      { label: "Available now", showHeader: true, items: visible.filter(isReleased) },
      { label: "Upcoming", showHeader: true, items: visible.filter((e) => !isReleased(e)) },
    ].filter((g) => g.items.length > 0);
  }, [visible, grouped]);

  if (isLoading) return null;
  if (!token) return null;

  const gameIds = visible.map((e) => e.game.id);

  const selectSort = (key: SortKey) => {
    setDir((d) => (sort === key ? (d === "asc" ? "desc" : "asc") : "asc"));
    setSort(key);
  };

  return (
    <div className="flex flex-col flex-1">
      <section className="bg-surface-container-lowest px-margin-page pt-[44px] pb-[36px]">
        <div className="max-w-page mx-auto flex flex-col gap-[28px]">
          <div>
            <h1 className="text-[52px] font-black leading-[1.05] tracking-[-0.04em] text-on-surface mb-2">
              Wishlist
            </h1>
            <p className="text-[17px] text-on-surface/45">
              {visible.length} games · prices via IsThereAnyDeal
            </p>
          </div>

          <div className="flex items-center gap-[20px] flex-wrap">
            <div className="flex items-center gap-2">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => selectSort(o.key)}
                  className={`${PILL_BASE} ${sort === o.key ? PILL_ACTIVE : PILL_INACTIVE}`}
                >
                  {o.label}
                </button>
              ))}
              <button
                onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
                title="Flip direction"
                className={`w-10 h-10 rounded-full flex items-center justify-center text-[17px] font-extrabold border transition-colors bg-surface-container text-on-surface/70 border-outline-variant/60 hover:text-on-surface`}
              >
                {dir === "asc" ? "↑" : "↓"}
              </button>
            </div>

            <div className="w-px h-[28px] bg-outline-variant/60" />

            <div className="flex items-center gap-[10px]">
              <button
                onClick={() => setDealsOnly((v) => !v)}
                className={`${PILL_BASE} ${dealsOnly ? PILL_ACTIVE : PILL_INACTIVE}`}
              >
                Near all-time low
              </button>
              <button
                onClick={() => setGrouped((v) => !v)}
                className={`${PILL_BASE} ${grouped ? PILL_ACTIVE : PILL_INACTIVE}`}
              >
                Split upcoming
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-page mx-auto px-margin-page pt-[40px] pb-[64px] w-full">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <span className="material-symbols-outlined text-5xl text-on-surface/20">bookmark</span>
            <p className="text-[17px] text-on-surface/40">Your wishlist is empty.</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label || "all"} className="mb-[44px]">
              {group.showHeader && (
                <div className="flex items-center gap-4 mb-[18px]">
                  <h2 className="text-[15px] font-extrabold tracking-[.16em] uppercase text-on-surface/50">
                    {group.label}
                  </h2>
                  <span className="text-[15px] font-bold text-on-surface/30">
                    {group.items.length} games
                  </span>
                  <div className="flex-1 h-px bg-outline-variant/45" />
                </div>
              )}

              <div className="flex flex-col gap-[12px]">
                {group.items.map(({ game, price, priceLoading }) => {
                  const releaseLabel = game.firstReleaseDate
                    ? new Date(game.firstReleaseDate).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                    : "Release TBD";
                  const current = price?.current ?? null;
                  const lowest = price?.lowest ?? null;
                  const atLow = current != null && lowest != null && current.price <= lowest.price;
                  const mc = metacriticChip(game.metacritic);

                  // The badge only marks an active discount — full-price and
                  // unlisted games show nothing here.
                  const cut = current?.cut ?? 0;
                  const onSale = current != null && cut > 0;

                  return (
                    <Link
                      key={game.id}
                      href={`/games/${game.id}`}
                      onClick={() => saveGameNavContext(gameIds, "Wishlist")}
                      className="flex gap-[28px] items-stretch flex-wrap p-4 bg-surface-container-low border border-outline-variant/30 hover:border-accent/40 transition-all duration-200 green-glow-hover"
                    >
                      {/* Cover art */}
                      <div className="w-[132px] max-[600px]:w-[104px] flex-shrink-0 aspect-[264/374] relative overflow-hidden bg-surface-container">
                        {game.coverPath ? (
                          <img
                            src={game.coverPath}
                            alt={game.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <span className="material-symbols-outlined text-4xl text-on-surface/20">
                              sports_esports
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 flex flex-col justify-center gap-[14px] py-1">
                        <h3 className="text-[28px] max-[600px]:text-[24px] font-extrabold tracking-[-0.025em] leading-[1.15] text-on-surface [text-wrap:pretty]">
                          {game.title}
                        </h3>
                        <div className="flex items-center gap-[14px] flex-wrap">
                          <span className="text-[17px] font-medium text-on-surface/[0.62]">
                            {releaseLabel}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-on-surface/25" />
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={`inline-flex items-center justify-center min-w-[34px] h-[28px] px-1.5 rounded-[5px] text-[17px] font-extrabold ${mc.className}`}
                            >
                              {mc.value}
                            </span>
                            <span className="text-[15px] font-semibold tracking-[.08em] uppercase text-on-surface/[0.42]">
                              Metacritic
                            </span>
                          </span>
                        </div>
                        <div className="text-[15px] text-on-surface/45">
                          {current ? `Best price at ${current.shop}` : "Awaiting store listing"}
                        </div>
                      </div>

                      {/* Price */}
                      <div className="w-[236px] flex-shrink-0 flex flex-col items-end justify-center gap-[10px] pl-6 border-l border-outline-variant/30 max-[900px]:w-full max-[900px]:items-start max-[900px]:pl-0 max-[900px]:border-l-0">
                        {priceLoading ? (
                          <>
                            <div className="h-[34px] w-[120px] bg-on-surface/10 animate-pulse" />
                            <div className="h-[15px] w-[90px] bg-on-surface/10 animate-pulse" />
                          </>
                        ) : (
                          <>
                            {onSale && (
                              <span className="px-3 py-[5px] rounded-[5px] text-[13px] font-extrabold tracking-[.1em] uppercase bg-accent/20 text-accent-light">
                                -{cut}% off
                              </span>
                            )}
                            <span
                              className={`text-[34px] font-extrabold tracking-[-0.03em] leading-none ${
                                current == null
                                  ? "text-on-surface/30"
                                  : atLow
                                    ? "text-accent-light"
                                    : "text-on-surface"
                              }`}
                            >
                              {current ? `$${current.price.toFixed(2)}` : "—"}
                            </span>
                            <span className="text-[15px] text-on-surface/[0.42]">
                              {lowest
                                ? `${atLow ? "At all-time low" : "All-time low"} $${lowest.price.toFixed(2)}`
                                : "No pricing history"}
                            </span>
                          </>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
