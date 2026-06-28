"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, type LibraryGame, type GameStatus, type Platform, type UserPlatform } from "@/lib/api";
import { CoverGrid } from "@/components/cover-grid";

export const dynamic = "force-dynamic";

const BUILTIN_PLATFORMS: { value: Platform; label: string }[] = [
  { value: "steam", label: "Steam" },
  { value: "psn", label: "PlayStation" },
  { value: "xbox", label: "Xbox / Game Pass" },
  { value: "epic", label: "Epic Games" },
  { value: "gog", label: "GOG" },
  { value: "meta_quest", label: "Meta Quest" },
];

const STATUSES: { value: GameStatus | ""; label: string }[] = [
  { value: "", label: "All Statuses" },
  { value: "unplayed", label: "Unplayed" },
  { value: "playing", label: "Playing" },
  { value: "completed", label: "Completed" },
  { value: "other", label: "Other" },
];

export default function LibraryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isLoading } = useAuth();
  const [games, setGames] = useState<LibraryGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [userPlatforms, setUserPlatforms] = useState<UserPlatform[]>([]);

  // platform filter: "steam" etc. for built-ins, "custom:123" for user platforms
  const [platform, setPlatform] = useState<string>(searchParams.get("platform") || "");
  const [status, setStatus] = useState<GameStatus | "">((searchParams.get("status") as GameStatus) || "");
  const [showAll, setShowAll] = useState(searchParams.get("show") !== "active");
  const [showHidden, setShowHidden] = useState(searchParams.get("hidden") === "1");
  const [showVr, setShowVr] = useState(searchParams.get("vr") === "1");

  function updateUrl(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    router.replace(`?${params.toString()}`);
  }

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  useEffect(() => {
    if (!token) return;
    api.getUserPlatforms(token).then(setUserPlatforms).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const isCustom = platform.startsWith("custom:");
    const customPlatformId = isCustom ? Number(platform.slice(7)) : undefined;
    const builtinPlatform = !isCustom && platform ? (platform as Platform) : undefined;
    api.getLibrary(token, {
      ...(builtinPlatform ? { platform: builtinPlatform } : {}),
      ...(customPlatformId ? { customPlatformId } : {}),
      ...(status ? { status } : {}),
      ...(showAll && !showHidden ? { all: true } : {}),
      ...(showHidden ? { hidden: true } : {}),
      ...(showVr ? { vr: true } : {}),
    })
      .then(setGames)
      .catch((err) => console.error("Library load error:", err))
      .finally(() => setLoading(false));
  }, [token, platform, status, showAll, showHidden, showVr]);

  if (isLoading) return null;
  if (!token) return null;

  return (
    <div className="flex flex-col flex-1">
      <section className="bg-surface-container-lowest px-margin-page py-10">
        <div className="max-w-page mx-auto">
          <h1 className="text-h1 font-black tracking-tight text-on-surface mb-6">Library</h1>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={platform}
              onChange={(e) => {
                const v = e.target.value;
                setPlatform(v);
                updateUrl({ platform: v || null });
              }}
              className="bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent transition-colors"
            >
              <option value="">All Platforms</option>
              {[
                ...BUILTIN_PLATFORMS.map((p) => ({ value: p.value, label: p.label })),
                ...userPlatforms.map((up) => ({ value: `custom:${up.id}`, label: up.name })),
              ].sort((a, b) => a.label.localeCompare(b.label)).map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>

            <select
              value={status}
              onChange={(e) => {
                const v = e.target.value as GameStatus | "";
                setStatus(v);
                updateUrl({ status: v || null });
              }}
              className="bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent transition-colors"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            <select
              value={showAll ? "all" : "active"}
              onChange={(e) => {
                const v = e.target.value === "all";
                setShowAll(v);
                updateUrl({ show: v ? null : "active" });
              }}
              disabled={showHidden}
              className="bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
            >
              <option value="all">All Owned</option>
              <option value="active">Active Only</option>
            </select>

            <button
              onClick={() => {
                const v = !showVr;
                setShowVr(v);
                updateUrl({ vr: v ? "1" : null });
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                showVr
                  ? "bg-accent/20 text-accent border-accent/30"
                  : "bg-surface-container text-on-surface/50 border-outline-variant/40 hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-base" style={{ fontSize: "16px" }}>
                vrpano
              </span>
              VR
            </button>

            <button
              onClick={() => {
                const v = !showHidden;
                setShowHidden(v);
                updateUrl({ hidden: v ? "1" : null });
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                showHidden
                  ? "bg-accent/20 text-accent border-accent/30"
                  : "bg-surface-container text-on-surface/50 border-outline-variant/40 hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-base" style={{ fontSize: "16px" }}>
                visibility_off
              </span>
              Hidden
            </button>

            <span className="ml-auto text-base font-medium text-on-surface/40">{games.length} games</span>
          </div>
        </div>
      </section>

      <div className="max-w-page mx-auto px-margin-page py-stack-lg w-full">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        ) : (
          <CoverGrid games={games} emptyMessage="No games found." navLabel="Library" gridClass="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3" />
        )}
      </div>
    </div>
  );
}
