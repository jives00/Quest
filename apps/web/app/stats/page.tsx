"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Gamepad2, Trophy, Star, CheckCircle2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useAuth } from "@/lib/auth-context";
import {
  api,
  type Stats, type YearStats, type ActivityEvent,
} from "@/lib/api";
import { ACTIVITY_ICONS, ACTIVITY_COLORS } from "@/lib/activity";

export const dynamic = "force-dynamic";

function fmtHours(min: number): string {
  if (!min) return "0h";
  const h = min / 60;
  if (h < 1) return `${min}m`;
  if (h < 100) return `${h.toFixed(1)}h`;
  return `${Math.round(h).toLocaleString()}h`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// For date-only values (completion dates stored as UTC midnight) — display in UTC so
// the date doesn't shift back one day for UTC-offset users.
function fmtDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: "short", day: "numeric", year: "numeric",
  });
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return fmtDate(iso);
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const dy = Math.floor(hr / 24);
  if (dy < 7) return `${dy}d ago`;
  return fmtDate(iso);
}


const PIE_COLORS = ["#e53935", "#1e88e5", "#43a047", "#fb8c00", "#8e24aa", "#00897b"];

const PLATFORM_LABELS: Record<string, string> = {
  steam: "Steam", psn: "PlayStation", xbox: "Xbox", epic: "Epic Games", gog: "GOG", meta_quest: "Meta Quest",
};

export default function StatsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isLoading } = useAuth();
  const [tab, setTab] = useState<"lifetime" | "year">((searchParams.get("tab") as "lifetime" | "year") || "lifetime");
  const [reviewYear, setReviewYear] = useState<number | null>(searchParams.get("year") ? Number(searchParams.get("year")) : null);

  function switchTab(t: "lifetime" | "year") {
    setTab(t);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", t);
    if (t === "lifetime") params.delete("year");
    router.replace(`?${params.toString()}`);
  }

  function handleYearChange(y: number) {
    setReviewYear(y);
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(y));
    router.replace(`?${params.toString()}`);
  }

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  if (isLoading || !token) return null;

  return (
    <div className="flex flex-col flex-1">
      <section className="bg-surface-container-lowest px-margin-page py-10">
        <div className="max-w-page mx-auto flex items-end justify-between gap-4">
          <h1 className="text-h1 font-black tracking-tight text-on-surface">Stats</h1>
          <div className="flex gap-2">
            {(["lifetime", "year"] as const).map((t) => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-bold uppercase tracking-widest transition-colors ${
                  tab === t ? "bg-accent text-white" : "bg-surface-container text-on-surface/60 hover:text-on-surface"
                }`}
              >
                {t === "lifetime" ? "Lifetime" : "Year in Review"}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="max-w-page mx-auto px-margin-page py-stack-lg w-full">
        {tab === "lifetime" ? <Lifetime token={token} /> : <YearReview token={token} initialYear={reviewYear} onYearChange={handleYearChange} />}
      </div>
    </div>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface-container rounded-xl border border-outline-variant/20 p-5">
      <p className="text-sm font-bold uppercase tracking-widest text-on-surface/40">{label}</p>
      <p className="text-2xl font-black text-on-surface mt-1">{value}</p>
      {hint && <p className="text-sm text-on-surface/40 mt-0.5">{hint}</p>}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold text-on-surface mb-4">{children}</h2>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface-container rounded-xl border border-outline-variant/20 ${className}`}>
      {children}
    </div>
  );
}

// ─── Custom chart tooltip ─────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, suffix = "" }: {
  active?: boolean; payload?: { value: number }[]; label?: string | number; suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-highest border border-outline-variant/30 rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="text-on-surface/60 text-sm font-bold uppercase tracking-widest">{label}</p>
      <p className="text-on-surface font-bold">{payload[0].value.toLocaleString()}{suffix}</p>
    </div>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────

function ActivityFeed({ events }: { events: ActivityEvent[] }) {
  if (!events.length) {
    return <p className="text-on-surface/40 text-sm px-5 py-4">No activity yet.</p>;
  }
  return (
    <div className="divide-y divide-outline-variant/20">
      {events.map((e, i) => {
        const Icon = ACTIVITY_ICONS[e.type] ?? Gamepad2;
        const color = ACTIVITY_COLORS[e.type] ?? "text-on-surface/60";
        let label = e.detail;
        if (e.type === "session") label = `Played for ${fmtHours(Number(e.detail))}`;
        if (e.type === "ownership") label = `Added to ${PLATFORM_LABELS[e.extra ?? ""] ?? e.extra} library`;
        return (
          <Link key={i} href={`/games/${e.gameId}`} className="flex items-center gap-3 px-4 py-4 hover:bg-on-surface/5 transition-colors">
            <div className="shrink-0 w-12 h-16 rounded-md overflow-hidden bg-surface-container relative">
              {e.type === "achievement" && e.extra ? (
                <img src={e.extra} alt="" className="w-full h-full object-cover" />
              ) : e.coverPath ? (
                <img src={e.coverPath} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className={`w-full h-full flex items-center justify-center ${color}`}>
                  <Icon className="w-5 h-5" />
                </div>
              )}
              {e.type !== "achievement" && (
                <div className={`absolute bottom-0.5 right-0.5 rounded-full p-0.5 bg-surface-container/80 ${color}`}>
                  <Icon className="w-3 h-3" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-medium text-on-surface truncate">{e.gameTitle}</p>
              <p className="text-sm text-on-surface/40 truncate">{label}</p>
            </div>
            <span className="shrink-0 text-sm text-on-surface/30 tabular-nums">{fmtDate(e.at)}</span>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Heatmap (calendar grid) ──────────────────────────────────────────────────

function CalendarHeatmap({ heatmap }: { heatmap: { date: string; minutes: number }[] }) {
  const byDate = new Map(heatmap.map(d => [d.date, d.minutes]));

  // Build 52 full weeks ending today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDay = new Date(today);
  startDay.setDate(today.getDate() - 364);
  // Rewind to Sunday
  startDay.setDate(startDay.getDate() - startDay.getDay());

  const weeks: { date: string; minutes: number }[][] = [];
  const cursor = new Date(startDay);
  while (cursor <= today) {
    const week: { date: string; minutes: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      week.push({ date: iso, minutes: byDate.get(iso) ?? 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  const maxMin = Math.max(1, ...heatmap.map(d => d.minutes));

  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, col) => {
    const [y, mo, da] = week[0].date.split("-").map(Number);
    const m = mo - 1;
    if (m !== lastMonth) {
      monthLabels.push({ col, label: new Date(y, m, da).toLocaleString(undefined, { month: "short" }) });
      lastMonth = m;
    }
  });

  return (
    <div className="w-full">
      {/* Month labels */}
      <div className="flex w-full mb-1">
        <div className="w-7 shrink-0" />
        {weeks.map((_, col) => {
          const lbl = monthLabels.find(l => l.col === col);
          return (
            <div key={col} className="flex-1 min-w-0">
              {lbl && <span className="text-sm text-on-surface/30">{lbl.label}</span>}
            </div>
          );
        })}
      </div>
      {/* Grid */}
      <div className="flex w-full gap-0.5">
        {/* Day-of-week labels */}
        <div className="flex flex-col gap-0.5 w-7 shrink-0 justify-around">
          {["S","M","T","W","T","F","S"].map((d, i) => (
            <div key={i} className="flex items-center h-full">
              {i % 2 === 1 && <span className="text-sm text-on-surface/30">{d}</span>}
            </div>
          ))}
        </div>
        {/* Week columns */}
        {weeks.map((week, col) => (
          <div key={col} className="flex-1 flex flex-col gap-0.5">
            {week.map(({ date, minutes }) => {
              const intensity = minutes / maxMin;
              const [y, mo, da] = date.split("-").map(Number);
              const label = new Date(y, mo - 1, da).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
              return (
                <div key={date} className="relative group w-full aspect-square">
                  <div
                    className="w-full h-full rounded-sm bg-accent"
                    style={{ opacity: minutes === 0 ? 0.08 : 0.2 + intensity * 0.8 }}
                  />
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 hidden group-hover:flex flex-col items-center">
                    <div className="bg-surface-container-high border border-outline-variant/40 rounded-lg px-2.5 py-1.5 text-center shadow-lg whitespace-nowrap">
                      <p className="text-xs font-medium text-on-surface">{label}</p>
                      <p className="text-xs text-on-surface/60">{minutes === 0 ? "No activity" : fmtHours(minutes)}</p>
                    </div>
                    <div className="w-2 h-2 bg-surface-container-high border-r border-b border-outline-variant/40 rotate-45 -mt-1" />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Lifetime dashboard ───────────────────────────────────────────────────────

function Lifetime({ token }: { token: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([
      api.getStats(token, new Date().getTimezoneOffset(), ac.signal),
      api.getActivity(token, ac.signal),
    ]).then(([s, a]) => { setStats(s); setActivity(a); })
      .catch((e) => { if (e?.name !== "AbortError") setError(String(e)); });
    return () => ac.abort();
  }, [token]);

  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (!stats) return <p className="text-on-surface/40 text-sm">Loading…</p>;

  const o = stats.overview;

  const platPieData = stats.byPlatform
    .filter(p => p.owned > 0)
    .map(p => ({ name: p.label, value: p.owned }));

  return (
    <div className="flex flex-col gap-12">

      {/* ── Overview ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Lifetime playtime" value={fmtHours(o.lifetimeMinutes)} hint={`${fmtHours(o.trackedMinutes)} tracked`} />
        <StatCard label="Achievements" value={o.achievementsUnlocked.toLocaleString()} hint={`${o.perfectGames} perfect games`} />
        <StatCard label="Backlog" value={((stats.statusCounts["unplayed"] ?? 0) + (stats.statusCounts["playing"] ?? 0)).toLocaleString()} hint="unplayed + playing" />
        <StatCard label="Completed" value={(stats.statusCounts["completed"] ?? 0).toLocaleString()} />
      </div>

      {/* ── Recent activity + charts ───────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-8 items-start">
        {/* Left: activity feed */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-on-surface">Recent Activity</h2>
            <Link href="/history" className="text-sm font-medium text-accent hover:underline">
              View All
            </Link>
          </div>
          <Card>
            <ActivityFeed events={activity} />
          </Card>
        </div>

        {/* Right: 5 compact charts */}
        <div className="flex flex-col gap-4">
          {stats.completionsByYear.length > 0 && (
            <div>
              <SectionHeader>Completed by Year</SectionHeader>
              <Card className="p-4">
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={[...stats.completionsByYear].reverse()} margin={{ top: 0, right: 0, left: -24, bottom: 0 }}>
                    <XAxis dataKey="year" tick={{ fontSize: 11, fill: "rgb(var(--on-surface-rgb) / 0.5)" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "rgb(var(--on-surface-rgb) / 0.5)" }} />
                    <Tooltip content={<ChartTooltip suffix=" games" />} cursor={{ fill: "rgb(var(--on-surface-rgb) / 0.05)" }} />
                    <Bar dataKey="count" fill="rgb(var(--accent-rgb))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          {stats.yearlyAchievements.length > 0 && (
            <div>
              <SectionHeader>Achievements by Year</SectionHeader>
              <Card className="p-4">
                <ResponsiveContainer width="100%" height={130}>
                  <BarChart data={[...stats.yearlyAchievements].reverse()} margin={{ top: 0, right: 0, left: -24, bottom: 0 }}>
                    <XAxis dataKey="year" tick={{ fontSize: 11, fill: "rgb(var(--on-surface-rgb) / 0.5)" }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "rgb(var(--on-surface-rgb) / 0.5)" }} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgb(var(--on-surface-rgb) / 0.05)" }} />
                    <Bar dataKey="count" fill="rgb(var(--accent-rgb) / 0.7)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          {platPieData.length > 0 && (
            <div>
              <SectionHeader>Ownership by Platform</SectionHeader>
              <Card className="p-4 flex items-center gap-4">
                <div className="shrink-0">
                  <ResponsiveContainer width={140} height={140}>
                    <PieChart>
                      <Pie data={platPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                        {platPieData.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const { name, value } = payload[0].payload as { name: string; value: number };
                        return <ChartTooltip active payload={[{ value }]} label={name} suffix=" games" />;
                      }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 flex-1">
                  {platPieData.map((entry, idx) => (
                    <div key={entry.name} className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                      <span className="text-sm text-on-surface/80 truncate">{entry.name}</span>
                      <span className="ml-auto shrink-0 text-sm text-on-surface/50 tabular-nums">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {stats.recentPlatformPlaytime.length > 0 && (() => {
            const max = Math.max(1, ...stats.recentPlatformPlaytime.map(x => x.playMinutes));
            return (
              <div>
                <SectionHeader>Playtime by Platform</SectionHeader>
                <Card className="p-4 flex flex-col gap-2">
                  {stats.recentPlatformPlaytime.map((p) => (
                    <div key={p.platform} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-sm text-on-surface/70 truncate">{p.label}</span>
                      <div className="flex-1 h-4 bg-surface-container rounded overflow-hidden">
                        <div className="h-full bg-accent/70 rounded" style={{ width: `${Math.max(2, (p.playMinutes / max) * 100)}%` }} />
                      </div>
                      <span className="w-12 shrink-0 text-right text-sm text-on-surface/50 tabular-nums">{fmtHours(p.playMinutes)}</span>
                    </div>
                  ))}
                </Card>
              </div>
            );
          })()}

          {stats.recentGenrePlaytime.length > 0 && (() => {
            const max = Math.max(1, ...stats.recentGenrePlaytime.map(x => x.playMinutes));
            return (
              <div>
                <SectionHeader>Playtime by Genre</SectionHeader>
                <Card className="p-4 flex flex-col gap-2">
                  {stats.recentGenrePlaytime.map((g) => (
                    <div key={g.genre} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-sm text-on-surface/70 truncate">{g.genre}</span>
                      <div className="flex-1 h-4 bg-surface-container rounded overflow-hidden">
                        <div className="h-full bg-accent/50 rounded" style={{ width: `${Math.max(2, (g.playMinutes / max) * 100)}%` }} />
                      </div>
                      <span className="w-16 shrink-0 text-right text-sm text-on-surface/50 tabular-nums">{fmtHours(g.playMinutes)}</span>
                    </div>
                  ))}
                </Card>
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Rarest achievements ─────────────────────────────────────────── */}
      {stats.rarityAchievements.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-on-surface">Rarest Achievements</h2>
            <Link href="/achievements" className="text-sm font-medium text-accent hover:underline">
              View All
            </Link>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 gap-4">
            {stats.rarityAchievements.map((a) => (
              <Link key={`${a.gameId}-${a.apiName}`} href={`/games/${a.gameId}`} className="group">
                <div className="aspect-square rounded-lg overflow-hidden bg-surface-container border border-outline-variant/20">
                  {a.icon ? (
                    <img src={a.icon} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Trophy className="w-6 h-6 text-yellow-400" />
                    </div>
                  )}
                </div>
                <p className="text-sm text-on-surface truncate mt-1.5">{a.name}</p>
                <p className="text-sm text-on-surface/40 truncate">{a.title}</p>
                <div className="flex items-center gap-1 text-yellow-400 mt-0.5">
                  <Star className="w-3 h-3" />
                  <span className="text-sm font-bold tabular-nums">{a.globalPct.toFixed(1)}%</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Perfect games ───────────────────────────────────────────────── */}
      {stats.perfectGames.length > 0 && (
        <div>
          <SectionHeader>Perfect Games ({stats.perfectGames.length})</SectionHeader>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 gap-4">
            {stats.perfectGames.map((g) => (
              <Link key={g.gameId} href={`/games/${g.gameId}`} className="group">
                <div className="aspect-[3/4] rounded-lg overflow-hidden bg-surface-container border border-outline-variant/20 relative">
                  {g.coverPath && (
                    <img src={g.coverPath} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  )}
                  <div className="absolute top-1 right-1 bg-yellow-400/90 text-black rounded-full p-0.5">
                    <Trophy className="w-3 h-3" />
                  </div>
                </div>
                <p className="text-sm text-on-surface truncate mt-1.5">{g.title}</p>
                <p className="text-sm text-on-surface/40">{g.achievementCount} achievements</p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Most played ─────────────────────────────────────────────────── */}
      {stats.topPlayed.length > 0 && (
        <div>
          <SectionHeader>Most Played</SectionHeader>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
            {stats.topPlayed.map((g) => (
              <Link key={g.gameId} href={`/games/${g.gameId}`} className="group">
                <div className="aspect-[3/4] rounded-lg overflow-hidden bg-surface-container border border-outline-variant/20">
                  {g.coverPath && (
                    <img src={g.coverPath} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  )}
                </div>
                <p className="text-sm text-on-surface truncate mt-1.5">{g.title}</p>
                <p className="text-sm text-on-surface/40">
                  {fmtHours(g.playMinutes)}
                  {g.completionCount > 0 && ` · ${g.completionCount}× completed`}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Activity heatmap ────────────────────────────────────────────── */}
      <div>
        <SectionHeader>Activity (last 365 days)</SectionHeader>
        <Card className="p-6">
          <CalendarHeatmap heatmap={stats.heatmap} />
        </Card>
      </div>

    </div>
  );
}

// ─── Year in review ───────────────────────────────────────────────────────────

function YearReview({ token, initialYear, onYearChange }: { token: string; initialYear: number | null; onYearChange: (y: number) => void }) {
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number | null>(initialYear);
  const [data, setData] = useState<YearStats | null>(null);

  useEffect(() => {
    api.getStatsYears(token).then((ys) => {
      setYears(ys);
      if (ys.length && year === null) {
        setYear(ys[0]);
        onYearChange(ys[0]);
      }
    }).catch((e) => console.error(e));
  }, [token]);

  useEffect(() => {
    if (year == null) return;
    setData(null);
    api.getYearStats(year, token).then(setData).catch((e) => console.error(e));
  }, [year, token]);

  if (!years.length) return (
    <p className="text-on-surface/40 text-sm">No dated activity yet — play something or add a play-history memory.</p>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-2">
        {years.map((y) => (
          <button
            key={y}
            onClick={() => { setYear(y); onYearChange(y); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${
              y === year ? "bg-accent text-white" : "bg-surface-container text-on-surface/60 hover:text-on-surface"
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      {!data ? (
        <p className="text-on-surface/40 text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Playtime" value={fmtHours(data.playMinutes)} hint={`${data.sessionCount} sessions`} />
            <StatCard label="Games played" value={String(data.gamesPlayed)} />
            <StatCard label="Games finished" value={String(data.gamesFinished)} hint="beaten or completed" />
            <StatCard label="Achievements" value={data.achievementsUnlocked.toLocaleString()} />
          </div>

          {data.topPlayed.length > 0 && (
            <div>
              <SectionHeader>Top Games of {data.year}</SectionHeader>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-4">
                {data.topPlayed.map((g) => (
                  <Link key={g.gameId} href={`/games/${g.gameId}`} className="group">
                    <div className="aspect-[3/4] rounded-lg overflow-hidden bg-surface-container border border-outline-variant/20">
                      {g.coverPath && (
                        <img src={g.coverPath} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      )}
                    </div>
                    <p className="text-sm text-on-surface truncate mt-1.5">{g.title}</p>
                    <p className="text-sm text-on-surface/40">{fmtHours(g.playMinutes)}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {data.finishedTitles.length > 0 && (
            <div>
              <SectionHeader>Finished in {data.year}</SectionHeader>
              <Card className="divide-y divide-outline-variant/20">
                {data.finishedTitles.map((g, i) => (
                  <Link key={`${g.gameId}-${i}`} href={`/games/${g.gameId}`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-on-surface/5 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                      <span className="text-sm text-on-surface truncate">{g.title}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {g.playMinutes > 0 && (
                        <span className="text-sm text-on-surface/60 tabular-nums">{fmtHours(g.playMinutes)}</span>
                      )}
                      {g.at && <span className="text-sm text-on-surface/40">{fmtDateOnly(g.at)}</span>}
                    </div>
                  </Link>
                ))}
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
