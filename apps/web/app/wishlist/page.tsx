"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, type LibraryGame, type WishlistPrice } from "@/lib/api";
import { saveGameNavContext } from "@/lib/game-nav-context";

export const dynamic = "force-dynamic";

type SortKey = "alpha" | "release" | "rating" | "price";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "alpha", label: "A–Z" },
  { key: "release", label: "Release" },
  { key: "rating", label: "Rating" },
  { key: "price", label: "Price" },
];

interface WishlistEntry {
  game: LibraryGame;
  price: WishlistPrice | null;
  priceLoading: boolean;
}

export default function WishlistPage() {
  const router = useRouter();
  const { token, isLoading } = useAuth();
  const [entries, setEntries] = useState<WishlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>("alpha");

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

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      switch (sort) {
        case "alpha":
          return a.game.title.localeCompare(b.game.title);
        case "release": {
          const ad = a.game.firstReleaseDate ?? null;
          const bd = b.game.firstReleaseDate ?? null;
          if (!ad && !bd) return 0;
          if (!ad) return 1;
          if (!bd) return -1;
          return bd.localeCompare(ad);
        }
        case "rating": {
          const ar = a.game.metacritic ?? null;
          const br = b.game.metacritic ?? null;
          if (ar == null && br == null) return 0;
          if (ar == null) return 1;
          if (br == null) return -1;
          return br - ar;
        }
        case "price": {
          const ap = a.price?.current?.price ?? null;
          const bp = b.price?.current?.price ?? null;
          if (ap == null && bp == null) return 0;
          if (ap == null) return 1;
          if (bp == null) return -1;
          return ap - bp;
        }
      }
    });
  }, [entries, sort]);

  if (isLoading) return null;
  if (!token) return null;

  const gameIds = sorted.map((e) => e.game.id);

  return (
    <div className="flex flex-col flex-1">
      <section className="bg-surface-container-lowest px-margin-page py-10">
        <div className="max-w-page mx-auto">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-h1 font-black tracking-tight text-on-surface mb-2">Wishlist</h1>
              <p className="text-on-surface/40 text-sm">{entries.length} games · synced from Steam</p>
            </div>
            <div className="flex items-center gap-1">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setSort(o.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    sort === o.key
                      ? "bg-accent text-white"
                      : "bg-surface-container text-on-surface/50 hover:text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-page mx-auto px-margin-page py-stack-lg w-full">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <span className="material-symbols-outlined text-5xl text-on-surface/20">bookmark</span>
            <p className="text-on-surface/40">Your wishlist is empty.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {sorted.map(({ game, price, priceLoading }) => {
              const releaseLabel = game.firstReleaseDate
                ? new Date(game.firstReleaseDate).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
                : "TBD";
              const currentPrice = price?.current;
              const lowestPrice = price?.lowest;

              return (
                <Link
                  key={game.id}
                  href={`/games/${game.id}`}
                  onClick={() => saveGameNavContext(gameIds, "Wishlist")}
                  className="group relative block overflow-hidden bg-surface-container-low border border-outline-variant/20 hover:border-accent/40 transition-all duration-200 green-glow-hover"
                >
                  {/* Cover art */}
                  <div className="aspect-[264/374] relative overflow-hidden bg-surface-container">
                    {game.coverPath ? (
                      <img
                        src={game.coverPath}
                        alt={game.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="material-symbols-outlined text-4xl text-on-surface/20">sports_esports</span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="px-2 py-2 flex flex-col gap-0.5">
                    <p className="text-sm font-semibold text-on-surface truncate leading-tight">{game.title}</p>
                    <p className="text-xs text-on-surface/40">{releaseLabel}</p>
                    {game.metacritic != null && (
                      <p className="text-xs text-on-surface/60">MC {game.metacritic}</p>
                    )}
                    {priceLoading ? (
                      <span className="mt-0.5 h-3 w-16 rounded bg-on-surface/10 animate-pulse" />
                    ) : price ? (
                      <p className="text-xs">
                        {currentPrice ? (
                          <span className="text-green-400 font-medium">${currentPrice.price.toFixed(2)}</span>
                        ) : (
                          <span className="text-on-surface/30">Not listed</span>
                        )}
                        {lowestPrice && (
                          <span className="text-on-surface/30"> | Low ${lowestPrice.price.toFixed(2)}</span>
                        )}
                      </p>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
