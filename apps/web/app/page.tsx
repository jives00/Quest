"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BarChart, Bar, Cell, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useAuth } from "@/lib/auth-context";
import {
  api,
  type DashboardResponse,
  type PlatformAccount,
  type DashboardSummary,
  type DashboardHero,
  type DailyPlayStat,
  type LibraryGame,
  type UpcomingGame,
  type NowPlayingInfo,
} from "@/lib/api";
import { CoverCard } from "@/components/cover-card";

export const dynamic = "force-dynamic";

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatTotalHours(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  return `${h.toLocaleString()}h`;
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const PLATFORM_LABELS: Record<string, string> = {
  steam: "Steam", psn: "PlayStation", xbox: "Xbox", epic: "Epic", gog: "GOG", meta_quest: "Quest",
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 text-h2 font-black tracking-tight text-on-surface">
      <span className="block h-8 w-1 rounded-full bg-accent" />
      {children}
    </h2>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function HeroSection({ hero, summary }: { hero: DashboardHero | null; summary: DashboardSummary | null }) {
  return (
    <section className="relative overflow-hidden bg-black" style={{ minHeight: 240 }}>
      {hero && (
        <img
          src={hero.heroPath}
          alt={hero.title}
          className="absolute right-0 top-0 h-full w-4/5 object-cover object-center"
        />
      )}

      {/* Fade from solid black on the left into transparent, revealing the image on the right */}
      <div className="absolute inset-0 z-[1] bg-gradient-to-r from-black from-[25%] via-black/20 via-[55%] to-transparent" />
      {/* Bottom vignette */}
      <div className="absolute inset-x-0 bottom-0 h-20 z-[1] bg-gradient-to-t from-black/50 to-transparent" />

      <div className="relative z-10 px-margin-page py-12 md:py-16">
        <h1 className="text-h1 font-black tracking-tight text-white mb-4">Quest</h1>
        {summary && (
          <div className="flex gap-8 md:gap-12">
            <HeroStat label="Games Owned" value={summary.totalGames.toLocaleString()} />
            <HeroStat label="Games Completed" value={summary.finishedCount.toLocaleString()} />
            <HeroStat label="Perfect Games" value={summary.perfectCount.toLocaleString()} />
          </div>
        )}
      </div>

      {hero && (
        <Link
          href={`/games/${hero.id}`}
          className="absolute bottom-3 right-4 z-10 text-sm font-bold text-white/50 hover:text-white/80 transition-colors"
        >
          {hero.title}
        </Link>
      )}
    </section>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-1">{label}</p>
      <p className="text-h2 font-black text-white">{value}</p>
    </div>
  );
}

function NowPlayingHero({ nowPlaying, summary }: { nowPlaying: NowPlayingInfo; summary: DashboardSummary | null }) {
  return (
    <section className="relative overflow-hidden bg-black" style={{ minHeight: 240 }}>
      {(nowPlaying.heroPath ?? nowPlaying.coverPath) && (
        <img
          src={(nowPlaying.heroPath ?? nowPlaying.coverPath)!}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-center"
          style={{ filter: "blur(2px) brightness(0.4)" }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/10" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent" />

      <div className="relative z-10 px-margin-page pt-10 pb-8 flex gap-6 items-end min-h-[240px] md:min-h-[300px]">
        {nowPlaying.coverPath && (
          <Link href={`/games/${nowPlaying.gameId}`} className="hidden md:block shrink-0">
            <img
              src={nowPlaying.coverPath}
              alt={nowPlaying.title}
              className="w-24 h-36 object-cover shadow-2xl"
            />
          </Link>
        )}
        <div className="flex-1 pb-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-white/60">Now Playing</span>
            <span className="text-[10px] text-white/40 ml-2">{PLATFORM_LABELS[nowPlaying.platform]}</span>
          </div>
          <Link href={`/games/${nowPlaying.gameId}`}>
            <h1 className="text-h1 font-black tracking-tight text-white mb-1 hover:text-white/80 transition-colors">
              {nowPlaying.title}
            </h1>
          </Link>
          <p className="text-sm text-white/50">Since {formatRelative(nowPlaying.since)}</p>
        </div>
        {summary && (
          <div className="hidden lg:flex gap-8 shrink-0">
            <HeroStat label="Games Owned" value={summary.totalGames.toLocaleString()} />
            <HeroStat label="Games Completed" value={summary.finishedCount.toLocaleString()} />
            <HeroStat label="Perfect Games" value={summary.perfectCount.toLocaleString()} />
          </div>
        )}
      </div>
    </section>
  );
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function PlaytimeBarChart({ data }: { data: DailyPlayStat[] }) {
  const [activeBar, setActiveBar] = useState<number | null>(null);

  const dataMap = new Map(data.map((d) => [d.date, d.totalMin]));
  const chartData = Array.from({ length: 30 }, (_, i) => {
    const dt = new Date();
    dt.setDate(dt.getDate() - (29 - i));
    // Use CT date so bars align with the server-side CONVERT_TZ('America/Chicago') grouping.
    const dateStr = dt.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const dayLabel = dateStr.slice(8).replace(/^0/, "");
    const totalMin = dataMap.get(dateStr) ?? 0;
    return {
      date: dayLabel,
      dateStr,
      hours: Math.round((totalMin / 60) * 10) / 10,
      totalMin,
    };
  });

  const totalMin = chartData.reduce((sum, d) => sum + d.totalMin, 0);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <SectionHeading>Last 30 Days</SectionHeading>
        {totalMin > 0 && (
          <p className="text-sm text-on-surface/50 mt-1 ml-4">{formatMinutes(totalMin)} played</p>
        )}
      </div>
      <div className="glass-panel p-5 rounded-xl">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ left: 0, right: 0, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tick={{ fill: "rgb(var(--on-surface-rgb) / 0.3)", fontSize: 9 }}
                interval={0}
              />
              <Tooltip
                cursor={false}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as (typeof chartData)[0];
                  const h = Math.floor(p.totalMin / 60);
                  const m = Math.round(p.totalMin % 60);
                  const time =
                    [h > 0 && `${h}h`, m > 0 && `${m}m`].filter(Boolean).join(" ") || "0m";
                  return (
                    <div
                      style={{
                        background: "rgb(var(--surface-container-rgb))",
                        border: "1px solid rgb(var(--on-surface-rgb) / 0.15)",
                        borderRadius: 8,
                        padding: "8px 12px",
                        fontSize: 13,
                        color: "rgb(var(--on-surface-rgb) / 0.85)",
                        lineHeight: 1.6,
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{time} played</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="hours" radius={[3, 3, 0, 0]} onMouseLeave={() => setActiveBar(null)}>
                {chartData.map((_, i) => (
                  <Cell
                    key={i}
                    fill={
                      activeBar === i
                        ? "rgb(var(--accent-rgb))"
                        : "rgb(var(--on-surface-rgb) / 0.2)"
                    }
                    onMouseEnter={() => setActiveBar(i)}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

// ── Game shelf (horizontal scroll) ────────────────────────────────────────────

function GameShelf({
  title,
  games,
  emptyMsg,
}: {
  title: string;
  games: LibraryGame[];
  emptyMsg: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading>{title}</SectionHeading>
      {games.length === 0 ? (
        <p className="text-on-surface/40 text-sm">{emptyMsg}</p>
      ) : (
        <div
          className="flex gap-4 overflow-x-auto pb-2"
          style={{ scrollbarWidth: "thin" }}
        >
          {games.map((game) => (
            <div key={game.id} className="flex-none w-52">
              <CoverCard game={game} showBadge={false} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Upcoming releases calendar ────────────────────────────────────────────────

function UpcomingSection({ games }: { games: UpcomingGame[] }) {
  if (games.length === 0) return null;

  const today = new Date();

  return (
    <section className="flex flex-col gap-4">
      <SectionHeading>Upcoming Releases</SectionHeading>
      <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: "thin" }}>
        {games.map((game) => {
          const d = new Date(game.releaseDate + "T00:00:00");
          const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const year = d.getFullYear();
          const isThisYear = year === today.getFullYear();
          return (
            <Link key={game.id} href={`/games/${game.id}`} className="group flex-none flex flex-col gap-2">
              <div className="relative w-44 aspect-[264/374] overflow-hidden bg-surface-container-low border border-outline-variant/20 hover:border-accent/40 transition-all duration-200 green-glow-hover">
                {game.coverPath ? (
                  <img
                    src={game.coverPath}
                    alt={game.title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="material-symbols-outlined text-3xl text-on-surface/20">
                      sports_esports
                    </span>
                  </div>
                )}
              </div>
              <div className="w-44">
                <p className="text-xs font-semibold text-on-surface truncate leading-tight">{game.title}</p>
                <p className="text-xs font-bold text-accent mt-0.5">
                  {label}{!isThisYear && ` ${year}`}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const { token, isLoading } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [platforms, setPlatforms] = useState<PlatformAccount[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [hero, setHero] = useState<DashboardHero | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyPlayStat[]>([]);
  const [playingGames, setPlayingGames] = useState<LibraryGame[]>([]);
  const [backlogGames, setBacklogGames] = useState<LibraryGame[]>([]);
  const [upcomingGames, setUpcomingGames] = useState<UpcomingGame[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  useEffect(() => {
    if (!token) return;

    async function load() {
      if (!token) return;
      try {
        const [dash, plats] = await Promise.all([
          api.getDashboard(token),
          api.getPlatforms(token),
        ]);
        setDashboard(dash);
        setPlatforms(plats);
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setLoading(false);
      }

      Promise.allSettled([
        api.getDashboardSummary(token),
        api.getDashboardHero(token),
        api.getDashboardDailyStats(token),
        api.getDashboardPlaying(token),
        api.getDashboardBacklog(token),
        api.getDashboardUpcoming(token),
      ]).then(([sumRes, heroRes, dailyRes, playRes, backlogRes, upcomingRes]) => {
        if (sumRes.status === "fulfilled") setSummary(sumRes.value);
        if (heroRes.status === "fulfilled") setHero(heroRes.value);
        if (dailyRes.status === "fulfilled") setDailyStats(dailyRes.value);
        if (playRes.status === "fulfilled") setPlayingGames(playRes.value);
        if (backlogRes.status === "fulfilled") setBacklogGames(backlogRes.value);
        if (upcomingRes.status === "fulfilled") setUpcomingGames(upcomingRes.value);
      });
    }

    load();

    pollRef.current = setInterval(async () => {
      if (!token) return;
      try {
        const np = await api.getNowPlaying(token);
        setDashboard((prev) =>
          prev ? { ...prev, nowPlaying: np.nowPlaying, lastPlayed: np.lastPlayed } : prev,
        );
      } catch {
        // silent
      }
    }, 30_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token]);

  if (isLoading || loading) return null;
  if (!token) return null;

  const redPlatforms = platforms.filter((p) => p.health === "red");
  const nowPlaying = dashboard?.nowPlaying ?? null;

  return (
    <div className="flex flex-col flex-1">
      {/* Auth warning banner */}
      {redPlatforms.length > 0 && (
        <div className="bg-red-600/90 text-white px-margin-page py-3 flex items-center gap-3">
          <span className="material-symbols-outlined text-base">warning</span>
          <p className="text-sm font-medium flex-1">
            {redPlatforms.map((p) => PLATFORM_LABELS[p.platform] ?? p.platform).join(", ")} need
            re-authentication.
          </p>
          <Link href="/settings" className="text-sm font-bold underline hover:no-underline">
            Fix in Settings →
          </Link>
        </div>
      )}

      {/* Hero */}
      {nowPlaying ? (
        <NowPlayingHero nowPlaying={nowPlaying} summary={summary} />
      ) : (
        <HeroSection hero={hero} summary={summary} />
      )}

      {/* Main content */}
      <div className="max-w-page mx-auto px-margin-page py-stack-lg w-full flex flex-col gap-stack-lg">

        {/* Currently Playing + Backlog */}
        <GameShelf
          title="Currently Playing"
          games={playingGames}
          emptyMsg="No games in progress. Mark a game as playing to see it here."
        />
        <GameShelf
          title="Backlog"
          games={backlogGames}
          emptyMsg="Your backlog is empty. Add games to your backlog list."
        />

        {/* Last 30 days bar chart */}
        <PlaytimeBarChart data={dailyStats} />

        {/* Upcoming releases from wishlist */}
        <UpcomingSection games={upcomingGames} />

      </div>
    </div>
  );
}
