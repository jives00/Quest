"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { PlatformIcon } from "@/components/icon-picker/render";
import {
  api,
  type GameDetail,
  type GameStatus,
  type Platform,
  type Achievement,
  type QuestList,
  type WishlistPrice,
  type PriceSource,
  PRICE_SOURCE_LABELS,
  type UserPlatform,
  type PlatformOverride,
} from "@/lib/api";
import { StatusSelector } from "@/components/status-badge";
import { GameMetadataEditor } from "@/components/game-metadata-editor";
import { GameRematch } from "@/components/game-rematch";
import { GameCompletionsCard } from "@/components/game-completions-card";
import { loadGameNavContext } from "@/lib/game-nav-context";
import { rarityLabel } from "@/lib/rarity";

export const dynamic = "force-dynamic";

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatDate(str: string): string {
  return new Date(str).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const PLATFORM_LABELS: Record<string, string> = {
  steam: "Steam", psn: "PlayStation", xbox: "Xbox", epic: "Epic", gog: "GOG", meta_quest: "Quest",
};
const ALL_PLATFORMS: Platform[] = ["steam", "psn", "xbox", "epic", "gog", "meta_quest"];


// ---------------------------------------------------------------------------
// Scores / controller chip helpers
// ---------------------------------------------------------------------------

function MetacriticBadge({ score, url }: { score: number; url?: string | null }) {
  const color =
    score >= 75 ? "bg-green-600 text-white" :
    score >= 50 ? "bg-yellow-500 text-black" :
    "bg-red-600 text-white";

  const inner = (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-bold ${color}`}>
      MC {score}
    </span>
  );
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" title="View on Metacritic">
        {inner}
      </a>
    );
  }
  return inner;
}

function SteamIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
    </svg>
  );
}

function XboxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M7.202 15.967a8 8 0 0 1-3.552-1.26c-.898-.585-1.101-.826-1.101-1.306 0-.965 1.062-2.656 2.879-4.583C6.459 7.723 7.897 6.44 8.052 6.475c.302.068 2.718 2.423 3.622 3.531 1.43 1.753 2.088 3.189 1.754 3.829-.254.486-1.83 1.437-2.987 1.802-.954.301-2.207.429-3.239.33m-5.866-3.57C.589 11.253.212 10.127.03 8.497c-.06-.539-.038-.846.137-1.95.218-1.377 1.002-2.97 1.945-3.95.401-.417.437-.427.926-.263.595.2 1.23.638 2.213 1.528l.574.519-.313.385C4.056 6.553 2.52 9.086 1.94 10.653c-.315.852-.442 1.707-.306 2.063.091.24.007.15-.3-.319Zm13.101.195c.074-.36-.019-1.02-.238-1.687-.473-1.443-2.055-4.128-3.508-5.953l-.457-.575.494-.454c.646-.593 1.095-.948 1.58-1.25.381-.237.927-.448 1.161-.448.145 0 .654.528 1.065 1.104a8.4 8.4 0 0 1 1.343 3.102c.153.728.166 2.286.024 3.012a9.5 9.5 0 0 1-.6 1.893c-.179.393-.624 1.156-.82 1.404-.1.128-.1.127-.043-.148ZM7.335 1.952c-.67-.34-1.704-.705-2.276-.803a4 4 0 0 0-.759-.043c-.471.024-.45 0 .306-.358A7.8 7.8 0 0 1 6.47.128c.8-.169 2.306-.17 3.094-.005.85.18 1.853.552 2.418.9l.168.103-.385-.02c-.766-.038-1.88.27-3.078.853-.361.176-.676.316-.699.312a12 12 0 0 1-.654-.319Z" />
    </svg>
  );
}

function EpicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M3.537 0C2.165 0 1.66.506 1.66 1.879V18.44a4.262 4.262 0 00.02.433c.031.3.037.59.316.92.027.033.311.245.311.245.153.075.258.13.43.2l8.335 3.491c.433.199.614.276.928.27h.002c.314.006.495-.071.928-.27l8.335-3.492c.172-.07.277-.124.43-.2 0 0 .284-.211.311-.243.28-.33.285-.621.316-.92a4.261 4.261 0 00.02-.434V1.879c0-1.373-.506-1.88-1.878-1.88zm13.366 3.11h.68c1.138 0 1.688.553 1.688 1.696v1.88h-1.374v-1.8c0-.369-.17-.54-.523-.54h-.235c-.367 0-.537.17-.537.539v5.81c0 .369.17.54.537.54h.262c.353 0 .523-.171.523-.54V8.619h1.373v2.143c0 1.144-.562 1.71-1.7 1.71h-.694c-1.138 0-1.7-.566-1.7-1.71V4.82c0-1.144.562-1.709 1.7-1.709zm-12.186.08h3.114v1.274H6.117v2.603h1.648v1.275H6.117v2.774h1.74v1.275h-3.14zm3.816 0h2.198c1.138 0 1.7.564 1.7 1.708v2.445c0 1.144-.562 1.71-1.7 1.71h-.799v3.338h-1.4zm4.53 0h1.4v9.201h-1.4zm-3.13 1.235v3.392h.575c.354 0 .523-.171.523-.54V4.965c0-.368-.17-.54-.523-.54zm-3.74 10.147a1.708 1.708 0 01.591.108 1.745 1.745 0 01.49.299l-.452.546a1.247 1.247 0 00-.308-.195.91.91 0 00-.363-.068.658.658 0 00-.28.06.703.703 0 00-.224.163.783.783 0 00-.151.243.799.799 0 00-.056.299v.008a.852.852 0 00.056.31.7.7 0 00.157.245.736.736 0 00.238.16.774.774 0 00.303.058.79.79 0 00.445-.116v-.339h-.548v-.565H7.37v1.255a2.019 2.019 0 01-.524.307 1.789 1.789 0 01-.683.123 1.642 1.642 0 01-.602-.107 1.46 1.46 0 01-.478-.3 1.371 1.371 0 01-.318-.455 1.438 1.438 0 01-.115-.58v-.008a1.426 1.426 0 01.113-.57 1.449 1.449 0 01.312-.46 1.418 1.418 0 01.474-.309 1.58 1.58 0 01.598-.111 1.708 1.708 0 01.045 0zm11.963.008a2.006 2.006 0 01.612.094 1.61 1.61 0 01.507.277l-.386.546a1.562 1.562 0 00-.39-.205 1.178 1.178 0 00-.388-.07.347.347 0 00-.208.052.154.154 0 00-.07.127v.008a.158.158 0 00.022.084.198.198 0 00.076.066.831.831 0 00.147.06c.062.02.14.04.236.061a3.389 3.389 0 01.43.122 1.292 1.292 0 01.328.17.678.678 0 01.207.24.739.739 0 01.071.337v.008a.865.865 0 01-.081.382.82.82 0 01-.229.285 1.032 1.032 0 01-.353.18 1.606 1.606 0 01-.46.061 2.16 2.16 0 01-.71-.116 1.718 1.718 0 01-.593-.346l.43-.514c.277.223.578.335.9.335a.457.457 0 00.236-.05.157.157 0 00.082-.142v-.008a.15.15 0 00-.02-.077.204.204 0 00-.073-.066.753.753 0 00-.143-.062 2.45 2.45 0 00-.233-.062 5.036 5.036 0 01-.413-.113 1.26 1.26 0 01-.331-.16.72.72 0 01-.222-.243.73.73 0 01-.082-.36v-.008a.863.863 0 01.074-.359.794.794 0 01.214-.283 1.007 1.007 0 01.34-.185 1.423 1.423 0 01.448-.066 2.006 2.006 0 01.025 0zm-9.358.025h.742l1.183 2.81h-.825l-.203-.499H8.623l-.198.498h-.81zm2.197.02h.814l.663 1.08.663-1.08h.814v2.79h-.766v-1.602l-.711 1.091h-.016l-.707-1.083v1.593h-.754zm3.469 0h2.235v.658h-1.473v.422h1.334v.61h-1.334v.442h1.493v.658h-2.255zm-5.3.897l-.315.793h.624zm-1.145 5.19h8.014l-4.09 1.348z" />
    </svg>
  );
}

function GogIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M7.15 15.24H4.36a.4.4 0 0 0-.4.4v2c0 .21.18.4.4.4h2.8v1.32h-3.5c-.56 0-1.02-.46-1.02-1.03v-3.39c0-.56.46-1.02 1.03-1.02h3.48v1.32zM8.16 11.54c0 .58-.47 1.05-1.05 1.05H2.63v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4H4.39a.4.4 0 0 0-.41.4v2.02c0 .23.18.4.4.4H6v1.35H3.68c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04H7.1c.58 0 1.05.47 1.05 1.04v5.86zM21.36 19.36h-1.32v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.12h-.93a.4.4 0 0 0-.4.4v3.72h-1.33v-4.42c0-.56.46-1.02 1.03-1.02h5.61v5.44zM21.37 11.54c0 .58-.47 1.05-1.05 1.05h-4.48v-1.35h3.78a.4.4 0 0 0 .4-.4V6.39a.4.4 0 0 0-.4-.4h-2.03a.4.4 0 0 0-.4.4v2.02c0 .23.18.4.4.4h1.62v1.35H16.9c-.58 0-1.05-.46-1.05-1.04V5.68c0-.57.47-1.04 1.05-1.04h3.43c.58 0 1.05.47 1.05 1.04v5.86zM13.72 4.64h-3.44c-.58 0-1.04.47-1.04 1.04v3.44c0 .58.46 1.04 1.04 1.04h3.44c.57 0 1.04-.46 1.04-1.04V5.68c0-.57-.47-1.04-1.04-1.04m-.3 1.75v2.02a.4.4 0 0 1-.4.4h-2.03a.4.4 0 0 1-.4-.4V6.4c0-.22.17-.4.4-.4H13c.23 0 .4.18.4.4zM12.63 13.92H9.24c-.57 0-1.03.46-1.03 1.02v3.39c0 .57.46 1.03 1.03 1.03h3.39c.57 0 1.03-.46 1.03-1.03v-3.39c0-.56-.46-1.02-1.03-1.02m-.3 1.72v2a.4.4 0 0 1-.4.4v-.01H9.94a.4.4 0 0 1-.4-.4v-1.99c0-.22.18-.4.4-.4h2c.22 0 .4.18.4.4zM23.49 1.1a1.74 1.74 0 0 0-1.24-.52H1.75A1.74 1.74 0 0 0 0 2.33v19.34a1.74 1.74 0 0 0 1.75 1.75h20.5A1.74 1.74 0 0 0 24 21.67V2.33c0-.48-.2-.92-.51-1.24m0 20.58a1.23 1.23 0 0 1-1.24 1.24H1.75A1.23 1.23 0 0 1 .5 21.67V2.33a1.23 1.23 0 0 1 1.24-1.24h20.5a1.24 1.24 0 0 1 1.24 1.24v19.34z" />
    </svg>
  );
}

function MetaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a6.624 6.624 0 0 0 .265.86 5.297 5.297 0 0 0 .371.761c.696 1.159 1.818 1.927 3.593 1.927 1.497 0 2.633-.671 3.965-2.444.76-1.012 1.144-1.626 2.663-4.32l.756-1.339.186-.325c.061.1.121.196.183.3l2.152 3.595c.724 1.21 1.665 2.556 2.47 3.314 1.046.987 1.992 1.22 3.06 1.22 1.075 0 1.876-.355 2.455-.843a3.743 3.743 0 0 0 .81-.973c.542-.939.861-2.127.861-3.745 0-2.72-.681-5.357-2.084-7.45-1.282-1.912-2.957-2.93-4.716-2.93-1.047 0-2.088.467-3.053 1.308-.652.57-1.257 1.29-1.82 2.05-.69-.875-1.335-1.547-1.958-2.056-1.182-.966-2.315-1.303-3.454-1.303zm10.16 2.053c1.147 0 2.188.758 2.992 1.999 1.132 1.748 1.647 4.195 1.647 6.4 0 1.548-.368 2.9-1.839 2.9-.58 0-1.027-.23-1.664-1.004-.496-.601-1.343-1.878-2.832-4.358l-.617-1.028a44.908 44.908 0 0 0-1.255-1.98c.07-.109.141-.224.211-.327 1.12-1.667 2.118-2.602 3.358-2.602zm-10.201.553c1.265 0 2.058.791 2.675 1.446.307.327.737.871 1.234 1.579l-1.02 1.566c-.757 1.163-1.882 3.017-2.837 4.338-1.191 1.649-1.81 1.817-2.486 1.817-.524 0-1.038-.237-1.383-.794-.263-.426-.464-1.13-.464-2.046 0-2.221.63-4.535 1.66-6.088.454-.687.964-1.226 1.533-1.533a2.264 2.264 0 0 1 1.088-.285z" />
    </svg>
  );
}

function SteamReviewPill({ desc, pct }: { desc: string; pct: number }) {
  const color =
    pct >= 80 ? "bg-blue-600/20 text-blue-400 border-blue-500/30" :
    pct >= 60 ? "bg-yellow-600/20 text-yellow-400 border-yellow-500/30" :
    "bg-red-600/20 text-red-400 border-red-500/30";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-sm font-medium ${color}`}>
      <SteamIcon className="w-3.5 h-3.5" />
      {desc} ({pct}%)
    </span>
  );
}

function ControllerChip({ support }: { support: "none" | "partial" | "full" }) {
  const labels = { none: "No controller", partial: "Partial controller", full: "Full controller" };
  const color =
    support === "full" ? "text-green-400" :
    support === "partial" ? "text-yellow-400" :
    "text-on-surface/40";
  return (
    <span className={`inline-flex items-center gap-1 text-sm ${color}`}>
      <span className="material-symbols-outlined text-base" style={{ fontSize: "16px" }}>sports_esports</span>
      {labels[support]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Wishlist price panel
// ---------------------------------------------------------------------------

function WishlistPricePanel({ gameId, token }: { gameId: number; token: string }) {
  const [price, setPrice] = useState<WishlistPrice | null | "loading">("loading");
  const [savingSource, setSavingSource] = useState(false);

  function load() {
    api.getWishlistPrice(gameId, token).then(setPrice).catch(() => setPrice(null));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, token]);

  // Pin (or unpin) the store this game is priced from, then refetch so the
  // panel reflects the new source immediately.
  async function chooseSource(next: PriceSource | "auto") {
    setSavingSource(true);
    try {
      if (next === "auto") await api.clearGamePriceSource(gameId, token);
      else await api.setGamePriceSource(gameId, next, token);
      setPrice("loading");
      load();
    } catch {
      // Leave the current price in place; the select resets on the next render.
    } finally {
      setSavingSource(false);
    }
  }

  if (price === "loading") {
    return (
      <section className="glass-panel p-5">
        <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40 mb-3">Best Price</h3>
        <div className="flex items-center gap-2 text-on-surface/40 text-sm">
          <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          Loading…
        </div>
      </section>
    );
  }

  if (!price) return null;

  // A source with no provider yet is worth saying out loud - otherwise the
  // panel just vanishes and looks broken.
  const unsupported = price.source != null && !price.supported;
  if (!price.current && !price.lowest && !unsupported && price.candidates.length < 2) return null;

  const sourcePicker =
    price.candidates.length > 1 ? (
      <div className="mt-4 pt-3 border-t border-outline-variant/20">
        <label
          htmlFor="price-source"
          className="block text-[9px] font-bold uppercase tracking-widest text-on-surface/30 mb-1.5"
        >
          Price from
        </label>
        <select
          id="price-source"
          value={price.overridden && price.source ? price.source : "auto"}
          disabled={savingSource}
          onChange={(e) => chooseSource(e.target.value as PriceSource | "auto")}
          className="w-full bg-surface-container border border-outline-variant/30 px-2 py-1.5 text-xs text-on-surface disabled:opacity-50"
        >
          <option value="auto">
            Automatic{price.source && !price.overridden ? ` (${PRICE_SOURCE_LABELS[price.source]})` : ""}
          </option>
          {price.candidates.map((c) => (
            <option key={c} value={c}>
              {PRICE_SOURCE_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
    ) : null;

  if (unsupported) {
    return (
      <section className="glass-panel p-5">
        <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40 mb-3">Best Price</h3>
        <p className="text-sm text-on-surface/40">
          No {PRICE_SOURCE_LABELS[price.source!]} price tracking yet.
        </p>
        {sourcePicker}
      </section>
    );
  }

  return (
    <section className="glass-panel p-5">
      <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40 mb-3">Best Price</h3>
      {price.current ? (
        <div className="mb-3">
          <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30">Current Best</p>
          <a
            href={price.current.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-1 text-accent hover:underline font-bold text-lg"
          >
            ${price.current.price.toFixed(2)}
            <span className="text-xs text-on-surface/50 font-normal">@ {price.current.shop}</span>
            <span className="material-symbols-outlined text-sm">open_in_new</span>
          </a>
        </div>
      ) : (
        <p className="text-sm text-on-surface/40 mb-3">No current deals found.</p>
      )}
      {price.lowest && (
        <p className="text-xs text-on-surface/40">
          Historical low: <span className="font-semibold">${price.lowest.price.toFixed(2)}</span>
        </p>
      )}
      {sourcePicker}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GameDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { token, isLoading } = useAuth();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [lists, setLists] = useState<QuestList[]>([]);
  const [userPlatforms, setUserPlatforms] = useState<UserPlatform[]>([]);
  const [platformOverrides, setPlatformOverrides] = useState<PlatformOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Editable state
  const [ratingInput, setRatingInput] = useState<number | null>(null);
  const [ratingSaving, setRatingSaving] = useState(false);

  // Achievement sort + grouping
  const [achSort, setAchSort] = useState<"default" | "rarity" | "date" | "name" | "locked">("default");
  const [groupDlc, setGroupDlc] = useState(true);

  // Action states
  const [enriching, setEnriching] = useState(false);

  // Modals
  const [showEdit, setShowEdit] = useState(false);
  const [showRematch, setShowRematch] = useState(false);
  const [showPlaytimeEdit, setShowPlaytimeEdit] = useState(false);
  const [playtimeInput, setPlaytimeInput] = useState("");
  const [playtimeSaving, setPlaytimeSaving] = useState(false);

  // Completions refresh trigger
  const [completionsRefreshKey, setCompletionsRefreshKey] = useState(0);

  // Media viewer: null = show trailer, string = show screenshot by image ID
  const [activeScreenshot, setActiveScreenshot] = useState<string | null>(null);

  // List keyboard navigation
  const navContext = useRef(loadGameNavContext());
  const currentGameId = params.id ? parseInt(params.id, 10) : null;
  const navIds = navContext.current?.ids ?? [];
  const navIndex = currentGameId !== null ? navIds.indexOf(currentGameId) : -1;
  const prevGameId = navIndex > 0 ? navIds[navIndex - 1] : null;
  const nextGameId = navIndex >= 0 && navIndex < navIds.length - 1 ? navIds[navIndex + 1] : null;

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  useEffect(() => {
    if (!token || !params.id) return;
    const id = parseInt(params.id, 10);
    Promise.all([api.getGame(id, token), api.getLists(token), api.getUserPlatforms(token), api.getPlatformOverrides(token)])
      .then(([g, ls, up, ov]) => {
        setGame(g);
        setRatingInput(g.rating);
        setLists(ls);
        setUserPlatforms(up);
        setPlatformOverrides(ov);
      })
      .catch((err: unknown) => setError((err instanceof Error ? err.message : null) ?? "Failed to load game."))
      .finally(() => setLoading(false));
  }, [token, params.id]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft" && prevGameId !== null) {
        router.push(`/games/${prevGameId}`);
      } else if (e.key === "ArrowRight" && nextGameId !== null) {
        router.push(`/games/${nextGameId}`);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [prevGameId, nextGameId, router]);

  const handleStatusChange = useCallback(async (status: GameStatus | null) => {
    if (!token || !game) return;
    try {
      if (status) {
        await api.setStatus(game.id, status, token);
      } else {
        await api.clearStatus(game.id, token);
      }
      setGame((prev) => prev ? { ...prev, status } : prev);
      if (status === "completed") {
        setCompletionsRefreshKey((k) => k + 1);
      }
    } catch (err) {
      console.error("Status update error:", err);
    }
  }, [token, game]);

  const handleRatingSave = useCallback(async (newRating: number | null) => {
    if (!token || !game) return;
    setRatingSaving(true);
    try {
      if (newRating !== null) {
        await api.setRating(game.id, newRating, token);
        setGame((prev) => prev ? { ...prev, rating: newRating } : prev);
      } else {
        await api.clearRating(game.id, token);
        setGame((prev) => prev ? { ...prev, rating: null } : prev);
      }
    } catch (err) {
      console.error("Rating save error:", err);
    } finally {
      setRatingSaving(false);
    }
  }, [token, game]);

  const handleOwnershipToggle = useCallback(async (platform: Platform, owns: boolean) => {
    if (!token || !game) return;
    try {
      if (owns) {
        await api.removeOwnership(game.id, platform, token);
        setGame((prev) => prev ? { ...prev, ownership: prev.ownership.filter((p) => p !== platform) } : prev);
      } else {
        await api.addOwnership(game.id, platform, token);
        setGame((prev) => prev ? { ...prev, ownership: [...prev.ownership, platform] } : prev);
      }
    } catch (err) {
      console.error("Ownership toggle error:", err);
    }
  }, [token, game]);

  const handleCustomOwnershipToggle = useCallback(async (platformId: number, owns: boolean) => {
    if (!token || !game) return;
    try {
      if (owns) {
        await api.removeCustomOwnership(game.id, platformId, token);
        setGame((prev) => prev ? { ...prev, customOwnership: prev.customOwnership.filter((id) => id !== platformId) } : prev);
      } else {
        await api.addCustomOwnership(game.id, platformId, token);
        setGame((prev) => prev ? { ...prev, customOwnership: [...prev.customOwnership, platformId] } : prev);
      }
    } catch (err) {
      console.error("Custom ownership toggle error:", err);
    }
  }, [token, game]);

  const handleListToggle = useCallback(async (listId: number, inList: boolean) => {
    if (!token || !game) return;
    try {
      if (inList) {
        await api.removeListItem(listId, game.id, token);
        setGame((prev) => prev ? { ...prev, lists: prev.lists.filter((id) => id !== listId) } : prev);
      } else {
        await api.addListItem(listId, game.id, token);
        setGame((prev) => prev ? { ...prev, lists: [...prev.lists, listId] } : prev);
      }
    } catch (err) {
      console.error("List toggle error:", err);
    }
  }, [token, game]);

  const handleEnrich = useCallback(async () => {
    if (!token || !game) return;
    setEnriching(true);
    try {
      const updated = await api.enrichGame(game.id, token);
      setGame(updated);
    } catch (err) {
      console.error("Enrich error:", err);
    } finally {
      setEnriching(false);
    }
  }, [token, game]);

  const handlePlaytimeEdit = useCallback(() => {
    if (!game) return;
    const manual = game.playtime.find((p) => p.source === "manual");
    const hltb = game.playtime.find((p) => p.source === "hltb");
    const current = manual ?? hltb ?? null;
    setPlaytimeInput(current ? String(Math.round(current.totalMin / 60 * 10) / 10) : "");
    setShowPlaytimeEdit(true);
  }, [game]);

  const handlePlaytimeSave = useCallback(async () => {
    if (!token || !game) return;
    setPlaytimeSaving(true);
    try {
      const hours = parseFloat(playtimeInput);
      const minutes = playtimeInput.trim() === "" || isNaN(hours) ? null : Math.round(hours * 60);
      const updated = await api.setManualPlaytime(game.id, minutes, token);
      setGame(updated);
      setShowPlaytimeEdit(false);
    } catch (err) {
      console.error("Playtime save error:", err);
    } finally {
      setPlaytimeSaving(false);
    }
  }, [token, game, playtimeInput]);

  if (isLoading || loading) return null;
  if (!token) return null;
  if (error) return <div className="max-w-page mx-auto px-margin-page py-16 text-red-400">{error}</div>;
  if (!game) return null;

  const sortedAchievements = [...game.achievements].sort((a, b) => {
    if (achSort === "rarity") {
      // Least rare first (highest %) across all achievements regardless of lock
      // state; null pct still sorts to the end, so it can't ride along with the
      // high percentages a sentinel value would put at the top.
      if (a.globalPct == null && b.globalPct == null) return 0;
      if (a.globalPct == null) return 1;
      if (b.globalPct == null) return -1;
      return b.globalPct - a.globalPct;
    }
    if (achSort === "date") {
      // Most recently unlocked first; locked to bottom
      if (!a.unlockedAt && !b.unlockedAt) return 0;
      if (!a.unlockedAt) return 1;
      if (!b.unlockedAt) return -1;
      return new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime();
    }
    if (achSort === "name") return a.name.localeCompare(b.name);
    if (achSort === "locked") return (a.unlockedAt ? 1 : 0) - (b.unlockedAt ? 1 : 0);
    return 0; // default: DB order (unlocked first, then A-Z)
  });

  const achievementGroups = (() => {
    const map = new Map<string, Achievement[]>();
    for (const a of sortedAchievements) {
      const key = a.dlcAppName != null && a.dlcAppName !== "" ? a.dlcAppName : "__base__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    const base = map.get("__base__") ?? [];
    const dlcs = [...map.entries()]
      .filter(([k]) => k !== "__base__")
      .sort(([, a], [, b]) => (a[0].dlcAppName ?? "").localeCompare(b[0].dlcAppName ?? ""));
    return [
      ...(base.length > 0 ? [{ label: dlcs.length > 0 ? "Base Game" : "Achievements", achievements: base }] : []),
      ...dlcs.map(([, achs]) => ({ label: achs[0].dlcAppName ?? "DLC", achievements: achs })),
    ];
  })();

  // VR list is toggled via the dedicated VR button, not the list section
  const systemLists = lists.filter((l) => l.kind === "system" && l.systemKey !== "vr");
  const customLists = lists.filter((l) => l.kind === "custom");

  const totalPlaytime = game.playtime.reduce((s, p) => s + p.totalMin, 0);
  const PLAYTIME_TRACKED = new Set(["steam", "psn", "xbox"]);
  const hasTrackedPlaytime = game.playtime.some((p) => PLAYTIME_TRACKED.has(p.source) && p.totalMin > 0);
  const hasHltbEstimate = game.playtime.some((p) => p.source === "hltb" && p.totalMin > 0);
  const hasManualPlaytime = game.playtime.some((p) => p.source === "manual" && p.totalMin > 0);
  const playtimeTracked = game.ownership.some((p) => PLAYTIME_TRACKED.has(p));

  return (
    <div className="flex flex-col flex-1">
      {/* ── Hero: background image + cover poster + title/tags ── */}
      <section className="relative bg-surface-container-lowest overflow-hidden">
        {/* Hero banner background */}
        {game.heroPath && (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${game.heroPath})` }}
              aria-hidden
            />
            <div className="absolute inset-0 bg-gradient-to-t from-surface-container-lowest/90 via-surface-container-lowest/40 to-transparent" aria-hidden />
          </>
        )}

        {/* List navigation chevrons */}
        {prevGameId !== null && (
          <button
            onClick={() => router.push(`/games/${prevGameId}`)}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-20 bg-black/30 hover:bg-black/50 backdrop-blur-sm rounded-full p-2 transition-colors text-white/70 hover:text-white flex items-center justify-center"
            aria-label="Previous game"
            title={`Previous game in ${navContext.current?.label ?? "list"}`}
          >
            <span className="material-symbols-outlined text-3xl">chevron_left</span>
          </button>
        )}
        {nextGameId !== null && (
          <button
            onClick={() => router.push(`/games/${nextGameId}`)}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-20 bg-black/30 hover:bg-black/50 backdrop-blur-sm rounded-full p-2 transition-colors text-white/70 hover:text-white flex items-center justify-center"
            aria-label="Next game"
            title={`Next game in ${navContext.current?.label ?? "list"}`}
          >
            <span className="material-symbols-outlined text-3xl">chevron_right</span>
          </button>
        )}

        {/* Action buttons — top right */}
        <div className="absolute top-4 right-4 z-10 flex gap-2">
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container/80 backdrop-blur text-on-surface/70 hover:text-on-surface border border-outline-variant/40 text-xs font-bold uppercase tracking-widest transition-colors"
            title="Refresh data from Steam / HLTB"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
            {enriching ? "Refreshing…" : "Refresh data"}
          </button>
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container/80 backdrop-blur text-on-surface/70 hover:text-on-surface border border-outline-variant/40 text-xs font-bold uppercase tracking-widest transition-colors"
            title="Edit metadata and artwork"
          >
            <span className="material-symbols-outlined text-sm">edit</span>
            Edit
          </button>
        </div>

        {/* Bottom row: cover poster (left) + title/tags (right), bottom-aligned */}
        <div className="relative max-w-page mx-auto px-margin-page pt-32 pb-6 flex items-end gap-6">
          {/* Cover poster */}
          {game.coverPath ? (
            <img
              src={game.coverPath}
              alt={game.title}
              className="w-52 aspect-[264/374] object-cover rounded-none shadow-2xl shrink-0"
            />
          ) : (
            <div className="w-52 aspect-[264/374] rounded-none bg-surface-container flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-5xl text-on-surface/20">sports_esports</span>
            </div>
          )}

          {/* Title + tags, pinned to the bottom of the poster */}
          <div className="flex flex-col justify-end pb-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {game.matchStatus === "provisional" && (
                <button onClick={() => setShowRematch(true)} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest bg-orange-500/20 text-orange-400 px-2 py-1 rounded">
                  <span className="material-symbols-outlined text-sm">warning</span>
                  Needs match — click to fix
                </button>
              )}
              {game.hidden && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest bg-surface-container text-on-surface/40 px-2 py-1 rounded">
                  <span className="material-symbols-outlined text-sm">visibility_off</span>
                  Hidden
                </span>
              )}
            </div>

            <h1 className="text-h1 font-black tracking-tight text-on-surface drop-shadow-lg">{game.title}</h1>

            {/* Genres + tags */}
            <div className="flex flex-wrap items-center gap-3 mt-3">
              {game.genres.map((g) => (
                <span key={g} className="text-[10px] font-semibold uppercase tracking-widest bg-black/30 backdrop-blur-sm px-2 py-1 rounded text-on-surface/80">
                  {g}
                </span>
              ))}
              {game.tags.map((t) => (
                <span key={t} className="text-[10px] font-semibold uppercase tracking-widest bg-accent/20 backdrop-blur-sm px-2 py-1 rounded text-accent">
                  {t}
                </span>
              ))}
            </div>

            {/* Scores row */}
            {(game.metacritic || game.steamReviewDesc || game.controllerSupport) && (
              <div className="flex flex-wrap items-center gap-3 mt-3">
                {game.metacritic && (
                  <MetacriticBadge score={game.metacritic} url={game.metacriticUrl} />
                )}
                {game.steamReviewDesc && game.steamReviewPct !== null && (
                  <SteamReviewPill desc={game.steamReviewDesc} pct={game.steamReviewPct} />
                )}
                {game.controllerSupport && (
                  <ControllerChip support={game.controllerSupport} />
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Main content grid ── */}
      <div className="max-w-page mx-auto px-margin-page pt-6 pb-stack-lg w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column: header + achievements */}
        <div className="lg:col-span-2 flex flex-col gap-8">
          <header>
            {(game.firstReleaseDate || game.platforms.length > 0) && (
              <div className="flex flex-wrap items-center gap-3 mb-4">
                {game.firstReleaseDate && (
                  <span className="text-sm text-on-surface/60">{formatDate(game.firstReleaseDate)}</span>
                )}
                {[...game.platforms].sort((a, b) => a.localeCompare(b)).map((p) => (
                  <span key={p} className="text-[10px] font-semibold uppercase tracking-widest bg-surface-container px-2 py-1 rounded text-on-surface/50">
                    {p}
                  </span>
                ))}
              </div>
            )}
            {game.summary && (
              <p className="text-on-surface/60 text-base leading-relaxed">{game.summary}</p>
            )}
          </header>
          {/* Media */}
          {(game.trailerVideoIds.length > 0 || game.screenshotImageIds.length > 0) && (
            <section className="flex flex-col gap-6">
              <div>
                <span className="block w-8 h-1 bg-accent rounded mb-2" />
                <h2 className="text-h2 font-black tracking-tight text-on-surface">Media</h2>
              </div>

              {/* Main display: trailer or selected screenshot */}
              {(() => {
                const mediaItems: Array<{ type: "trailer" | "screenshot"; id: string }> = [
                  ...(game.trailerVideoIds[0] ? [{ type: "trailer" as const, id: game.trailerVideoIds[0] }] : []),
                  ...game.screenshotImageIds.map((id) => ({ type: "screenshot" as const, id })),
                ];
                const activeIndex = activeScreenshot === null
                  ? (game.trailerVideoIds[0] ? 0 : -1)
                  : mediaItems.findIndex((m) => m.type === "screenshot" && m.id === activeScreenshot);
                const goTo = (idx: number) => {
                  const item = mediaItems[idx];
                  if (!item) return;
                  setActiveScreenshot(item.type === "trailer" ? null : item.id);
                };
                return (
                  <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: "16/9" }}>
                    {activeScreenshot ? (
                      <img
                        src={`https://images.igdb.com/igdb/image/upload/t_1080p/${activeScreenshot}.jpg`}
                        alt=""
                        className="absolute inset-0 w-full h-full object-contain"
                      />
                    ) : game.trailerVideoIds[0] ? (
                      <iframe
                        src={`https://www.youtube.com/embed/${game.trailerVideoIds[0]}`}
                        title={`${game.title} trailer`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        loading="lazy"
                        className="absolute inset-0 w-full h-full"
                      />
                    ) : null}
                    {mediaItems.length > 1 && (
                      <>
                        <button
                          onClick={() => goTo((activeIndex - 1 + mediaItems.length) % mediaItems.length)}
                          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 bg-black/40 hover:bg-black/70 backdrop-blur-sm rounded-full p-1.5 text-white/80 hover:text-white transition-colors flex items-center justify-center"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "24px", lineHeight: 1 }}>chevron_left</span>
                        </button>
                        <button
                          onClick={() => goTo((activeIndex + 1) % mediaItems.length)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 bg-black/40 hover:bg-black/70 backdrop-blur-sm rounded-full p-1.5 text-white/80 hover:text-white transition-colors flex items-center justify-center"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: "24px", lineHeight: 1 }}>chevron_right</span>
                        </button>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Thumbnail strip */}
              {(game.trailerVideoIds.length > 0 || game.screenshotImageIds.length > 0) && (
                <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
                  {game.trailerVideoIds[0] && (
                    <button
                      onClick={() => setActiveScreenshot(null)}
                      className={`flex-none relative overflow-hidden border-2 transition-all ${activeScreenshot === null ? "border-accent" : "border-transparent hover:border-outline-variant"}`}
                    >
                      <img
                        src={`https://img.youtube.com/vi/${game.trailerVideoIds[0]}/mqdefault.jpg`}
                        alt="Trailer"
                        className="h-20 w-auto object-cover"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <span className="material-symbols-outlined text-white text-2xl">play_circle</span>
                      </span>
                    </button>
                  )}
                  {game.screenshotImageIds.map((id) => (
                    <button
                      key={id}
                      onClick={() => setActiveScreenshot(id)}
                      className={`flex-none overflow-hidden border-2 transition-all ${activeScreenshot === id ? "border-accent" : "border-transparent hover:border-outline-variant"}`}
                    >
                      <img
                        src={`https://images.igdb.com/igdb/image/upload/t_screenshot_med/${id}.jpg`}
                        alt=""
                        className="h-20 w-auto object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Achievements */}
          <section className="mt-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="block w-8 h-1 bg-accent rounded mb-2" />
                <h2 className="text-h2 font-black tracking-tight text-on-surface">Achievements</h2>
                {game.achievementTotal > 0 && (
                  <p className="text-sm text-on-surface/50 mt-1">
                    <span className="font-bold text-on-surface/80">{game.achievementEarned}</span>/{game.achievementTotal}
                    <span className="ml-1">({Math.round((game.achievementEarned / game.achievementTotal) * 100)}%)</span>
                  </p>
                )}
              </div>
              {game.achievementTotal > 0 && (
                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-2 flex-wrap justify-end">
                    {(["default", "rarity", "date", "name", "locked"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setAchSort(s)}
                        className={`text-xs font-bold uppercase tracking-widest px-2 py-1 rounded ${
                          achSort === s ? "bg-accent/20 text-accent" : "text-on-surface/40 hover:text-on-surface"
                        }`}
                      >
                        {s === "default" ? "Default" : s === "rarity" ? "Rarity" : s === "date" ? "Date" : s === "name" ? "Name" : "Locked"}
                      </button>
                    ))}
                  </div>
                  {achievementGroups.length > 1 && (
                    <button
                      onClick={() => setGroupDlc((v) => !v)}
                      className={`text-xs font-bold uppercase tracking-widest px-2 py-1 rounded border transition-colors ${
                        groupDlc
                          ? "bg-accent/20 text-accent border-accent/30"
                          : "text-on-surface/40 border-outline-variant/30 hover:text-on-surface"
                      }`}
                    >
                      Group DLC
                    </button>
                  )}
                </div>
              )}
            </div>

            {game.achievementTotal === 0 ? (
              <p className="text-on-surface/40 text-sm">No achievements.</p>
            ) : !groupDlc || achievementGroups.length === 1 ? (
              <div className="flex flex-col gap-2">
                {sortedAchievements.map((ach) => (
                  <AchievementRow key={ach.apiName} achievement={ach} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-6 mt-10">
                {achievementGroups.map((group) => {
                  const earned = group.achievements.filter((a) => a.unlockedAt).length;
                  const total = group.achievements.length;
                  const pct = total > 0 ? Math.round((earned / total) * 100) : 0;
                  return (
                    <details key={group.label} open>
                      <summary className="cursor-pointer list-none mb-3 select-none">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-base font-bold uppercase tracking-widest text-white">{group.label}</span>
                          <span className="text-sm font-semibold text-on-surface/70">
                            {earned}/{total} ({pct}%)
                          </span>
                        </div>
                        <div className="h-1.5 bg-surface-container rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </summary>
                      <div className="flex flex-col gap-2 mt-3">
                        {group.achievements.map((ach) => (
                          <AchievementRow key={ach.apiName} achievement={ach} />
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>

        </div>

        {/* Right: Actions sidebar */}
        <div className="flex flex-col gap-6">
          {/* Wishlist price panel. Not gated on itadEnabled: ITAD only covers
              the 'pc' source, so gating on it would hide a PlayStation or Quest
              game's panel. The panel resolves its own source and renders
              nothing when there is genuinely nothing to say. */}
          {game.inWishlist && <WishlistPricePanel gameId={game.id} token={token} />}

          {/* Status */}
          <section className="glass-panel p-5">
            <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40 mb-3">Status</h3>
            <StatusSelector current={game.status} onChange={handleStatusChange} />
          </section>

          {/* Completions */}
          <GameCompletionsCard
            gameId={game.id}
            token={token}
            status={game.status}
            refreshKey={completionsRefreshKey}
          />

          {/* Playtime */}
          <section className="glass-panel p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40">Playtime</h3>
              <button
                onClick={handlePlaytimeEdit}
                className="text-on-surface/30 hover:text-on-surface/70 transition-colors"
                title="Edit playtime"
              >
                <span className="material-symbols-outlined text-base" style={{ fontSize: "16px" }}>edit</span>
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30">
                  {hasTrackedPlaytime ? "Tracked" : "Time Played"}
                </p>
                <p className="text-lg font-bold text-on-surface">
                  {totalPlaytime > 0 ? formatMinutes(totalPlaytime) : (playtimeTracked ? "0m" : "Not tracked")}
                </p>
                {!hasTrackedPlaytime && hasHltbEstimate && (
                  <p className="text-[10px] text-on-surface/30 mt-0.5">est. from HLTB</p>
                )}
                {!hasTrackedPlaytime && hasManualPlaytime && (
                  <p className="text-[10px] text-on-surface/30 mt-0.5">manually set</p>
                )}
              </div>
              {game.lifetimeMin > 0 && (
                <div>
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30">Lifetime (pre-tracking)</p>
                  <p className="text-lg font-bold text-on-surface/60">{formatMinutes(game.lifetimeMin)}</p>
                </div>
              )}
              {(game.hltbMainHours || game.hltbMainExtraHours || game.hltbCompletionistHours) && (
                <div className="border-t border-outline-variant/20 pt-3">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30 mb-2">How Long to Beat</p>
                  <div className="flex gap-6">
                    {game.hltbMainHours && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30">Main</p>
                        <p className="text-base font-bold text-on-surface/70">~{game.hltbMainHours}h</p>
                      </div>
                    )}
                    {game.hltbMainExtraHours && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30">Main+Extras</p>
                        <p className="text-base font-bold text-on-surface/70">~{game.hltbMainExtraHours}h</p>
                      </div>
                    )}
                    {game.hltbCompletionistHours && (
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30">Completionist</p>
                        <p className="text-base font-bold text-on-surface/70">~{game.hltbCompletionistHours}h</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Playtime edit modal */}
          {showPlaytimeEdit && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowPlaytimeEdit(false)} />
              <div className="relative glass-panel p-6 w-full max-w-sm shadow-2xl">
                <h2 className="text-h2 font-black tracking-tight text-on-surface mb-1">Edit Playtime</h2>
                <p className="text-sm text-on-surface/50 mb-5">
                  Enter hours played. Leave blank to clear.
                  {hasTrackedPlaytime && (
                    <span className="block mt-1 text-accent/80">
                      This game has platform-tracked time — your entry will be added on top.
                    </span>
                  )}
                </p>
                <div className="flex items-center gap-3 mb-5">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={playtimeInput}
                    onChange={(e) => setPlaytimeInput(e.target.value)}
                    placeholder="e.g. 12.5"
                    className="flex-1 bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") handlePlaytimeSave(); }}
                  />
                  <span className="text-sm text-on-surface/50 shrink-0">hours</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handlePlaytimeSave}
                    disabled={playtimeSaving}
                    className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold uppercase tracking-widest hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    {playtimeSaving ? "Saving…" : "Save"}
                  </button>
                  <button
                    onClick={() => setShowPlaytimeEdit(false)}
                    className="px-4 py-2 rounded-lg bg-surface-container text-on-surface/60 border border-outline-variant/40 text-sm font-bold uppercase tracking-widest"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Rating */}
          <section className="glass-panel p-5">
            <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40 mb-3">Rating</h3>
            <div className="flex gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  disabled={ratingSaving}
                  onClick={() => {
                    const newVal = ratingInput === n ? null : n;
                    setRatingInput(newVal);
                    handleRatingSave(newVal);
                  }}
                  className={`w-7 h-7 rounded text-xs font-bold transition-colors ${
                    ratingInput !== null && n <= ratingInput
                      ? "bg-accent text-white"
                      : "bg-surface-container text-on-surface/40 hover:bg-surface-container-high"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </section>

          {/* Ownership */}
          <section className="glass-panel p-5">
            <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40 mb-3">Ownership</h3>
            <div className="flex flex-wrap gap-2">
              {ALL_PLATFORMS.map((plat) => {
                const owns = game.ownership.includes(plat);
                const ov = platformOverrides.find((o) => o.platform === plat);
                const defaultIcon = (() => {
                  if (plat === "steam") return <SteamIcon className="w-5 h-5" />;
                  if (plat === "psn") return <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5" aria-hidden><path d="M8.985 2.596v17.548l3.915 1.261V6.688c0-.69.304-1.151.794-.998.636.19.762.84.762 1.529v5.372c2.689 1.088 4.718-.169 4.718-3.53 0-3.44-1.194-4.988-4.688-6.076 0 0-3.037-.987-5.501-.389zM7.641 20.26c-2.69.239-4.73-1.075-4.73-2.963 0-1.79 1.567-3.272 4.33-3.862v2.01c-1.213.353-2.148.965-2.148 1.894 0 .995 1.002 1.494 2.548 1.214v1.707z"/></svg>;
                  if (plat === "xbox") return <XboxIcon className="w-5 h-5" />;
                  if (plat === "epic") return <EpicIcon className="w-5 h-5" />;
                  if (plat === "gog") return <GogIcon className="w-5 h-5" />;
                  if (plat === "meta_quest") return <MetaIcon className="w-5 h-5" />;
                })();
                return (
                  <button
                    key={plat}
                    onClick={() => handleOwnershipToggle(plat, owns)}
                    title={ov?.name ?? PLATFORM_LABELS[plat]}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors border ${
                      owns
                        ? "bg-accent/20 text-accent border-accent/30"
                        : "bg-surface-container text-on-surface/40 border-outline-variant/30 hover:text-on-surface hover:border-outline-variant/60"
                    }`}
                  >
                    {ov?.icon ? <PlatformIcon value={ov.icon} size={20} /> : defaultIcon}
                  </button>
                );
              })}
              {userPlatforms.map((up) => {
                const owns = game.customOwnership.includes(up.id);
                return (
                  <button
                    key={up.id}
                    onClick={() => handleCustomOwnershipToggle(up.id, owns)}
                    title={up.name}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors border ${
                      owns
                        ? "bg-accent/20 text-accent border-accent/30"
                        : "bg-surface-container text-on-surface/40 border-outline-variant/30 hover:text-on-surface hover:border-outline-variant/60"
                    }`}
                  >
                    <PlatformIcon value={up.icon} fallback={<span className="text-xs font-bold">{up.name.slice(0, 2).toUpperCase()}</span>} size={20} />
                  </button>
                );
              })}
            </div>
          </section>

          {/* External Links */}
          {game.steamAppId && (
            <section className="glass-panel p-5">
              <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40 mb-3">Links</h3>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: "Steam", url: `https://store.steampowered.com/app/${game.steamAppId}` },
                  { label: "SteamDB", url: `https://steamdb.info/app/${game.steamAppId}/` },
                  { label: "ProtonDB", url: `https://www.protondb.com/app/${game.steamAppId}` },
                  { label: "PCGamingWiki", url: `https://www.pcgamingwiki.com/api/appid.php?appid=${game.steamAppId}` },
                ].map((l) => (
                  <a
                    key={l.label}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-surface-container border border-outline-variant/30 text-sm font-medium text-on-surface/60 hover:text-on-surface hover:border-outline-variant/60 transition-colors"
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Lists */}
          <section className="glass-panel p-5">
            <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40 mb-3">Lists</h3>
            <div className="flex flex-col gap-2">
              {[...systemLists, ...customLists].map((l) => {
                const inList = game.lists.includes(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => handleListToggle(l.id, inList)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-base font-medium transition-colors ${
                      inList
                        ? "bg-accent/20 text-accent border border-accent/30"
                        : "bg-surface-container text-on-surface/50 border border-outline-variant/30 hover:text-on-surface"
                    }`}
                  >
                    <span>{l.name}</span>
                    <span className="material-symbols-outlined text-base">
                      {inList ? "check_circle" : "add_circle"}
                    </span>
                  </button>
                );
              })}
              {lists.length === 0 && (
                <p className="text-xs text-on-surface/30">No lists yet.</p>
              )}
            </div>
          </section>

          <Link
            href={`/history?gameId=${game.id}`}
            className="text-sm font-medium text-accent hover:underline text-center"
          >
            View History
          </Link>

        </div>
      </div>

      {showEdit && (
        <GameMetadataEditor
          game={game}
          token={token}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => setGame(updated)}
          onOpenRematch={() => setShowRematch(true)}
        />
      )}
      {showRematch && (
        <GameRematch
          game={game}
          token={token}
          onClose={() => setShowRematch(false)}
          onRematched={(updated) => setGame(updated)}
        />
      )}
    </div>
  );
}

function AchievementRow({ achievement }: { achievement: Achievement }) {
  const unlocked = !!achievement.unlockedAt;
  const hiddenLocked = achievement.isHidden && !unlocked;
  const rarity = achievement.globalPct != null ? rarityLabel(achievement.globalPct) : null;

  return (
    <div className="bg-surface-container px-4 py-3 flex items-center gap-4">
      {achievement.icon ? (
        <img src={achievement.icon} alt="" className={`self-stretch w-auto max-h-16 shrink-0 ${!unlocked ? "opacity-40 grayscale" : ""}`} />
      ) : (
        <div className="self-stretch max-h-16 aspect-square bg-surface-container flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-on-surface/20 text-xl">emoji_events</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-base font-semibold ${unlocked ? "text-on-surface" : "text-on-surface/60"}`}>{achievement.name}</p>
          {hiddenLocked && (
            <span className="material-symbols-outlined text-on-surface/30 text-base" title="Hidden achievement">lock</span>
          )}
        </div>
        {achievement.description ? (
          <p className={`text-sm mt-0.5 line-clamp-2 ${unlocked ? "text-on-surface/50" : "text-on-surface/40"}`}>{achievement.description}</p>
        ) : achievement.isHidden ? (
          <p className="text-sm text-on-surface/30 mt-0.5 italic">Description hidden</p>
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

