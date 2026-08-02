"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Trophy } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api, type AllAchievement, type AchievementSort, type AchievementGameOption } from "@/lib/api";
import { rarityLabel } from "@/lib/rarity";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

const SORTS: { value: AchievementSort; label: string }[] = [
  { value: "rarity", label: "Rarity" },
  { value: "date", label: "Date" },
  { value: "name", label: "Name" },
  { value: "locked", label: "Locked" },
];

function AchievementCard({ achievement }: { achievement: AllAchievement }) {
  const unlocked = !!achievement.unlockedAt;
  const rarity = achievement.globalPct != null ? rarityLabel(achievement.globalPct) : null;

  return (
    <div className="bg-surface-container px-4 py-3 flex items-center gap-4">
      {achievement.icon ? (
        <img
          src={achievement.icon}
          alt=""
          className={`self-stretch w-auto max-h-16 shrink-0 ${!unlocked ? "opacity-40 grayscale" : ""}`}
        />
      ) : (
        <div className="self-stretch max-h-16 aspect-square bg-surface-container-high flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-on-surface/20 text-xl">emoji_events</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-base font-semibold ${unlocked ? "text-on-surface" : "text-on-surface/60"}`}>{achievement.name}</p>
        </div>
        <Link href={`/games/${achievement.gameId}`} className="text-sm text-accent hover:underline">
          {achievement.gameTitle}
        </Link>
        {achievement.description ? (
          <p className={`text-sm mt-0.5 line-clamp-2 ${unlocked ? "text-on-surface/50" : "text-on-surface/40"}`}>{achievement.description}</p>
        ) : null}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {achievement.unlockedAt && (
            <p className="text-sm text-on-surface/40">Unlocked {new Date(achievement.unlockedAt).toLocaleDateString()}</p>
          )}
          {rarity && (
            <span className={`text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${rarity.className}`}>
              {rarity.label} · {achievement.globalPct!.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
      {unlocked && (
        <span className="material-symbols-outlined text-accent text-xl shrink-0">check_circle</span>
      )}
    </div>
  );
}

export default function AllAchievementsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isLoading } = useAuth();

  const [sort, setSort] = useState<AchievementSort>((searchParams.get("sort") as AchievementSort) || "date");
  const [gameId, setGameId] = useState<number | undefined>(
    searchParams.get("gameId") ? Number(searchParams.get("gameId")) : undefined,
  );
  const [games, setGames] = useState<AchievementGameOption[]>([]);

  const [achievements, setAchievements] = useState<AllAchievement[]>([]);
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
    api.getAchievementGames(token).then(setGames).catch(() => {});
  }, [token]);

  function updateUrl(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    router.replace(`?${params.toString()}`);
  }

  // Reset and reload from page 1 whenever sort/filter changes
  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setPage(1);
    api
      .getAllAchievements(token, { sort, gameId, page: 1, limit: PAGE_SIZE })
      .then((res) => {
        setAchievements(res.achievements);
        setTotal(res.total);
      })
      .catch((err) => console.error("Achievements load error:", err))
      .finally(() => setLoading(false));
  }, [token, sort, gameId]);

  const loadMore = useCallback(() => {
    if (!token || loading || loadingMore) return;
    if (achievements.length >= total) return;
    const nextPage = page + 1;
    setLoadingMore(true);
    api
      .getAllAchievements(token, { sort, gameId, page: nextPage, limit: PAGE_SIZE })
      .then((res) => {
        setAchievements((prev) => [...prev, ...res.achievements]);
        setTotal(res.total);
        setPage(nextPage);
      })
      .catch((err) => console.error("Achievements load-more error:", err))
      .finally(() => setLoadingMore(false));
  }, [token, sort, gameId, page, loading, loadingMore, achievements.length, total]);

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
          <h1 className="text-h1 font-black tracking-tight text-on-surface mb-1">Achievements</h1>
          <p className="text-sm text-on-surface/50 mb-6">{total.toLocaleString()} achievements across your library</p>

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
                <option key={g.gameId} value={g.gameId}>
                  {g.title} ({g.achievementCount})
                </option>
              ))}
            </select>

            <div className="flex gap-2 flex-wrap">
              {SORTS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => {
                    setSort(s.value);
                    updateUrl({ sort: s.value });
                  }}
                  className={`text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-lg ${
                    sort === s.value
                      ? "bg-accent/20 text-accent"
                      : "bg-surface-container text-on-surface/40 hover:text-on-surface"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-page mx-auto px-margin-page py-stack-lg w-full">
        {loading ? (
          <p className="text-on-surface/40 text-sm">Loading…</p>
        ) : achievements.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-on-surface/40">
            <Trophy className="w-10 h-10 mb-3" />
            <p>No achievements found.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {achievements.map((a) => (
              <AchievementCard key={`${a.gameId}-${a.apiName}`} achievement={a} />
            ))}
          </div>
        )}

        <div ref={sentinelRef} className="h-1" />
        {loadingMore && <p className="text-center text-on-surface/40 text-sm py-4">Loading more…</p>}
      </div>
    </div>
  );
}
