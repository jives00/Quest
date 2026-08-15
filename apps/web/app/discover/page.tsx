"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  api,
  type DiscoverCategory,
  type DiscoverGame,
} from "@/lib/api";

export const dynamic = "force-dynamic";

const CATEGORIES: {
  id: DiscoverCategory;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    id: "trending",
    label: "Trending",
    icon: "trending_up",
    description: "Recently released games getting the most attention",
  },
  {
    id: "new_releases",
    label: "New Releases",
    icon: "fiber_new",
    description: "Latest games from the past 6 months",
  },
  {
    id: "anticipated",
    label: "Most Anticipated",
    icon: "event_upcoming",
    description: "Upcoming games with the most hype",
  },
  {
    id: "top_rated",
    label: "Top Rated",
    icon: "star",
    description: "Highest rated games by critics",
  },
  {
    id: "steam_top_sellers",
    label: "Steam Top Sellers",
    icon: "local_fire_department",
    description: "What's selling right now on Steam",
  },
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 1989 }, (_, i) => CURRENT_YEAR - i);

export default function DiscoverPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isLoading } = useAuth();

  const [category, setCategory] = useState<DiscoverCategory>((searchParams.get("cat") as DiscoverCategory) || "trending");
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);
  const [year, setYear] = useState<number | undefined>(searchParams.get("year") ? Number(searchParams.get("year")) : undefined);
  function updateUrl(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    router.replace(`?${params.toString()}`);
  }
  const [items, setItems] = useState<DiscoverGame[]>([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setItems([]);
    setError(null);
    try {
      const result = await api.discover(category, token, { page, year });
      setItems(result.items);
      setHasNextPage(result.hasNextPage);
    } catch (err) {
      setItems([]);
      setHasNextPage(false);
      setError(err instanceof Error ? err.message : 'Failed to load results');
    } finally {
      setLoading(false);
    }
  }, [token, category, page, year]);

  useEffect(() => {
    load();
  }, [load]);

  function switchCategory(cat: DiscoverCategory) {
    setItems([]);
    setHasNextPage(false);
    setError(null);
    setLoading(true);
    setCategory(cat);
    setPage(1);
    setYear(undefined);
    updateUrl({ cat: cat === "trending" ? null : cat, page: null, year: null, genre: null });
  }

  async function handleGameClick(game: DiscoverGame) {
    if (game.libraryId) {
      router.push(`/games/${game.libraryId}`);
      return;
    }
    if (!game.igdbId || !token) return;
    setAddingId(game.igdbId);
    try {
      const result = await api.addGame(game.igdbId, token);
      router.push(`/games/${result.id}`);
    } catch {
      router.push(`/search?q=${encodeURIComponent(game.name)}`);
    } finally {
      setAddingId(null);
    }
  }

  if (isLoading) return null;
  if (!token) return null;

  const activeCat = CATEGORIES.find((c) => c.id === category)!;
  const isSteam = category === "steam_top_sellers";

  return (
    <div className="flex flex-col flex-1">
      {/* Mobile category bar */}
      <div className="lg:hidden flex overflow-x-auto gap-2 px-4 py-3 border-b border-outline-variant/20 bg-surface-container-lowest shrink-0 scrollbar-hide">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => switchCategory(cat.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              category === cat.id
                ? "bg-accent/15 text-accent"
                : "text-on-surface/60 bg-surface-container hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
              {cat.icon}
            </span>
            {cat.label}
          </button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="hidden lg:block w-56 shrink-0 border-r border-outline-variant/20 bg-surface-container-lowest sticky top-16 self-start h-[calc(100vh-4rem)] overflow-y-auto">
          <div className="p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-on-surface/40 mb-3 px-2">
              Categories
            </p>
            <nav className="flex flex-col gap-0.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => switchCategory(cat.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-left w-full transition-colors ${
                    category === cat.id
                      ? "bg-accent/15 text-accent"
                      : "text-on-surface/60 hover:text-on-surface hover:bg-on-surface/5"
                  }`}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                    {cat.icon}
                  </span>
                  {cat.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 flex flex-col">
          {/* Header */}
          <div className="px-6 py-5 border-b border-outline-variant/20 bg-surface-container-lowest">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-on-surface">
                  {activeCat.label}
                </h1>
                <p className="text-sm text-on-surface/50 mt-0.5">{activeCat.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {category === "top_rated" && (
                  <select
                    value={year ?? ""}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : undefined;
                      setYear(v);
                      setPage(1);
                      updateUrl({ year: v ? String(v) : null, page: null });
                    }}
                    className="bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent transition-colors"
                  >
                    <option value="">All Time</option>
                    {YEARS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>

          {/* Grid */}
          <div className="p-6 flex-1">
            {loading ? (
              <div
                className={
                  isSteam
                    ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
                    : "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3"
                }
              >
                {Array.from({ length: 24 }).map((_, i) => (
                  <div
                    key={i}
                    className={`${
                      isSteam ? "aspect-[460/215]" : "aspect-[264/374]"
                    } bg-surface-container animate-pulse`}
                  />
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <span className="material-symbols-outlined text-5xl text-on-surface/20">
                  error
                </span>
                <p className="text-on-surface/40">Failed to load: {error}</p>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <span className="material-symbols-outlined text-5xl text-on-surface/20">
                  sports_esports
                </span>
                <p className="text-on-surface/40">No games found.</p>
              </div>
            ) : isSteam ? (
              <div key={category} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {items.map((game, idx) => (
                  <SteamCard key={game.steamAppId} game={game} rank={idx + 1} />
                ))}
              </div>
            ) : (
              <div key={category} className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                {items.map((game) => (
                  <DiscoverCard
                    key={game.igdbId}
                    game={game}
                    isAdding={addingId === game.igdbId}
                    onClick={() => handleGameClick(game)}
                  />
                ))}
              </div>
            )}

            {/* Pagination */}
            {!isSteam && !loading && items.length > 0 && (
              <div className="flex items-center justify-center gap-4 mt-8">
                <button
                  onClick={() => { const p = Math.max(1, page - 1); setItems([]); setLoading(true); setPage(p); updateUrl({ page: p > 1 ? String(p) : null }); }}
                  disabled={page === 1}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-outline-variant/40 text-sm font-medium text-on-surface disabled:opacity-40 hover:bg-on-surface/5 transition-colors"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                    chevron_left
                  </span>
                  Previous
                </button>
                <span className="text-sm text-on-surface/50">Page {page}</span>
                <button
                  onClick={() => { const p = page + 1; setItems([]); setLoading(true); setPage(p); updateUrl({ page: String(p) }); }}
                  disabled={!hasNextPage}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-outline-variant/40 text-sm font-medium text-on-surface disabled:opacity-40 hover:bg-on-surface/5 transition-colors"
                >
                  Next
                  <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                    chevron_right
                  </span>
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function DiscoverCard({
  game,
  isAdding,
  onClick,
}: {
  game: DiscoverGame;
  isAdding?: boolean;
  onClick: () => void;
}) {
  const rating = game.aggregatedRating ?? game.rating;
  const ratingColor =
    rating !== null
      ? rating >= 85
        ? "bg-green-600/90"
        : rating >= 70
        ? "bg-yellow-600/90"
        : "bg-red-600/90"
      : "";

  return (
    <button
      onClick={onClick}
      disabled={isAdding}
      className="group relative block text-left overflow-hidden bg-surface-container-low border border-outline-variant/20 hover:border-accent/40 transition-all duration-200 green-glow-hover w-full disabled:opacity-70"
    >
      <div className="aspect-[264/374] relative overflow-hidden bg-surface-container">
        {game.coverUrl ? (
          <img
            src={game.coverUrl}
            alt={game.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="material-symbols-outlined text-4xl text-on-surface/20">
              sports_esports
            </span>
          </div>
        )}

        {isAdding && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {rating !== null && !isAdding && (
          <div
            className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold text-white ${ratingColor}`}
          >
            {Math.round(rating)}
          </div>
        )}

        {game.libraryId && !isAdding && (
          <div className="absolute top-1.5 left-1.5 bg-accent/90 rounded-full w-5 h-5 flex items-center justify-center">
            <span className="material-symbols-outlined text-white" style={{ fontSize: "12px" }}>
              check
            </span>
          </div>
        )}
      </div>

      <div className="px-2 py-2">
        <p className="text-sm font-semibold text-on-surface leading-tight line-clamp-2">
          {game.name}
        </p>
        {game.year && (
          <p className="text-xs text-on-surface/40 mt-0.5">{game.year}</p>
        )}
      </div>
    </button>
  );
}

function SteamCard({ game, rank }: { game: DiscoverGame; rank: number }) {
  // coverUrl is the capsule URL the storefront API itself returned, so it is
  // preferred outright. The appid-derived path is only a fallback: it 404s for
  // any app whose art lives under a content hash, which is most new releases —
  // exactly what tends to chart as a top seller.
  const sources = useMemo(
    () =>
      [
        game.coverUrl,
        `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/header.jpg`,
      ].filter((u): u is string => Boolean(u)),
    [game.coverUrl, game.steamAppId]
  );
  const [failedCount, setFailedCount] = useState(0);
  const capsuleUrl = sources[failedCount] ?? null;

  const finalCents = game.finalPrice ?? null;
  const origCents = game.originalPrice ?? null;
  const discount = game.discountPct ?? 0;

  const formatPrice = (cents: number) =>
    cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}`;

  return (
    <a
      href={`https://store.steampowered.com/app/${game.steamAppId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden bg-surface-container-low border border-outline-variant/20 hover:border-accent/40 transition-all duration-200 green-glow-hover"
    >
      <div className="aspect-[460/215] relative overflow-hidden bg-surface-container">
        {capsuleUrl && (
          <img
            // Remount on source change so a retry actually re-fires onError.
            key={capsuleUrl}
            src={capsuleUrl}
            alt={game.name}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => setFailedCount((n) => n + 1)}
          />
        )}
        <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-bold px-2 py-0.5 rounded">
          #{rank}
        </div>
      </div>

      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-on-surface truncate">{game.name}</p>
        {finalCents !== null && (
          <div className="shrink-0 flex items-center gap-1.5">
            {discount > 0 && origCents !== null && (
              <>
                <span className="bg-green-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                  -{discount}%
                </span>
                <span className="text-xs text-on-surface/40 line-through">
                  {formatPrice(origCents)}
                </span>
              </>
            )}
            <span className="text-sm font-medium text-on-surface">
              {formatPrice(finalCents)}
            </span>
          </div>
        )}
      </div>
    </a>
  );
}
