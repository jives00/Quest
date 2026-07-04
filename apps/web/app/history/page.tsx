"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Gamepad2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api, type ActivityEvent, type ActivityEventType, type LibraryGame } from "@/lib/api";
import { ACTIVITY_ICONS, ACTIVITY_COLORS, ACTIVITY_TYPE_LABELS } from "@/lib/activity";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

const PLATFORM_LABELS: Record<string, string> = {
  steam: "Steam", psn: "PlayStation", xbox: "Xbox", epic: "Epic Games", gog: "GOG", meta_quest: "Meta Quest",
};

function fmtHours(min: number): string {
  if (!min) return "0h";
  const h = min / 60;
  if (h < 1) return `${min}m`;
  if (h < 100) return `${h.toFixed(1)}h`;
  return `${Math.round(h).toLocaleString()}h`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

const TYPES: { value: ActivityEventType | ""; label: string }[] = [
  { value: "", label: "All Types" },
  { value: "session", label: ACTIVITY_TYPE_LABELS.session },
  { value: "achievement", label: ACTIVITY_TYPE_LABELS.achievement },
  { value: "completion", label: ACTIVITY_TYPE_LABELS.completion },
  { value: "status", label: ACTIVITY_TYPE_LABELS.status },
  { value: "wishlist", label: ACTIVITY_TYPE_LABELS.wishlist },
  { value: "backlog", label: ACTIVITY_TYPE_LABELS.backlog },
  { value: "ownership", label: ACTIVITY_TYPE_LABELS.ownership },
];

function ActivityRow({ event }: { event: ActivityEvent }) {
  const Icon = ACTIVITY_ICONS[event.type] ?? Gamepad2;
  const color = ACTIVITY_COLORS[event.type] ?? "text-on-surface/60";
  let label = event.detail;
  if (event.type === "session") label = `Played for ${fmtHours(Number(event.detail))}`;
  if (event.type === "ownership") label = `Added to ${PLATFORM_LABELS[event.extra ?? ""] ?? event.extra} library`;

  return (
    <Link href={`/games/${event.gameId}`} className="flex items-center gap-4 px-4 py-4 hover:bg-on-surface/5 transition-colors bg-surface-container rounded-lg">
      <div className="shrink-0 w-12 h-16 rounded-md overflow-hidden bg-surface-container-high relative">
        {event.type === "achievement" && event.extra ? (
          <img src={event.extra} alt="" className="w-full h-full object-cover" />
        ) : event.coverPath ? (
          <img src={event.coverPath} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${color}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
        {event.type !== "achievement" && (
          <div className={`absolute bottom-0.5 right-0.5 rounded-full p-0.5 bg-surface-container/80 ${color}`}>
            <Icon className="w-3 h-3" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-medium text-on-surface truncate">{event.gameTitle}</p>
        <p className="text-sm text-on-surface/40 truncate">{label}</p>
      </div>
      <span className="shrink-0 text-sm text-on-surface/30 tabular-nums">{fmtDateTime(event.at)}</span>
    </Link>
  );
}

export default function HistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isLoading } = useAuth();

  const [type, setType] = useState<ActivityEventType | "">((searchParams.get("type") as ActivityEventType) || "");
  const [gameId, setGameId] = useState<number | undefined>(
    searchParams.get("gameId") ? Number(searchParams.get("gameId")) : undefined,
  );
  const [games, setGames] = useState<LibraryGame[]>([]);

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  useEffect(() => {
    if (!token) return;
    api.getLibrary(token, { all: true }).then(setGames).catch(() => {});
  }, [token]);

  function updateUrl(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    router.replace(`?${params.toString()}`);
  }

  // Reset and reload from page 1 whenever filters change
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setPage(1);
    api
      .getActivityPage(token, { type: type || undefined, gameId, page: 1, limit: PAGE_SIZE })
      .then((res) => {
        setEvents(res.events);
        setTotal(res.total);
      })
      .catch((err) => console.error("History load error:", err))
      .finally(() => setLoading(false));
  }, [token, type, gameId]);

  const loadMore = useCallback(() => {
    if (!token || loading || loadingMore) return;
    if (events.length >= total) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    api
      .getActivityPage(token, { type: type || undefined, gameId, page: nextPage, limit: PAGE_SIZE })
      .then((res) => {
        setEvents((prev) => [...prev, ...res.events]);
        setTotal(res.total);
        setPage(nextPage);
      })
      .catch((err) => console.error("History load-more error:", err))
      .finally(() => setLoadingMore(false));
  }, [token, type, gameId, page, loading, loadingMore, events.length, total]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  if (isLoading) return null;
  if (!token) return null;

  return (
    <div className="flex flex-col flex-1">
      <section className="bg-surface-container-lowest px-margin-page py-10">
        <div className="max-w-page mx-auto">
          <h1 className="text-h1 font-black tracking-tight text-on-surface mb-1">History</h1>
          <p className="text-sm text-on-surface/50 mb-6">{total.toLocaleString()} events across your library</p>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={gameId ?? ""}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : undefined;
                setGameId(v);
                updateUrl({ gameId: v ? String(v) : null });
              }}
              className="bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent transition-colors"
            >
              <option value="">All Games</option>
              {games.map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>

            <select
              value={type}
              onChange={(e) => {
                const v = e.target.value as ActivityEventType | "";
                setType(v);
                updateUrl({ type: v || null });
              }}
              className="bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent transition-colors"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <div className="max-w-page mx-auto px-margin-page py-stack-lg w-full">
        {loading ? (
          <p className="text-on-surface/40 text-sm">Loading…</p>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-on-surface/40">
            <Gamepad2 className="w-10 h-10 mb-3" />
            <p>No activity found.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {events.map((e, i) => (
              <ActivityRow key={`${e.type}-${e.gameId}-${e.at}-${i}`} event={e} />
            ))}
          </div>
        )}

        <div ref={sentinelRef} className="h-1" />
        {loadingMore && <p className="text-center text-on-surface/40 text-sm py-4">Loading more…</p>}
      </div>
    </div>
  );
}
