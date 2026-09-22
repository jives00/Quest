"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GAME_STATUS_LABELS } from "@quest/types";
import type { GameStatus, LibraryGame } from "@/lib/api";
import { hltbEstimate, formatHltbHours } from "@/lib/hltb";

interface CoverCardProps {
  game: LibraryGame;
  showBadge?: boolean;
  showReleaseDate?: boolean;
  /** Show the HowLongToBeat playtime estimate on hover over the artwork. */
  showHltb?: boolean;
  /**
   * Enables the hover menu of contextual status moves. Queuing a replay or
   * starting a game shouldn't require opening it, so the grid offers the same
   * moves the Shelf block does.
   */
  onQuickStatus?: (gameId: number, status: GameStatus) => void;
  onClick?: () => void;
}

/** The same next-move shortcuts the Shelf block offers, minus the Replay
 *  toggle — list membership isn't in the grid's payload. */
function gridActions(status: string | null): GameStatus[] {
  switch (status) {
    case "wishlist":   return ["backlog"];
    case "backlog":    return ["playing", "skipped"];
    case "playing":    return ["completed", "backlog"];
    case "completed":  return ["backlog", "playing"];
    case "skipped":    return ["backlog", "playing"];
    default:           return ["backlog", "playing", "completed"];
  }
}

function QuickStatusMenu({
  game,
  onPick,
}: {
  game: LibraryGame;
  onPick: (gameId: number, status: GameStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="absolute top-1.5 right-1.5 z-10">
      <button
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label="Change status"
        className={`flex items-center justify-center w-7 h-7 rounded-full bg-black/70 text-white/80 hover:text-white transition-opacity ${
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      >
        <span className="material-symbols-outlined text-base" style={{ fontSize: "16px" }}>more_horiz</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 min-w-[10rem] rounded-lg bg-surface-container-high border border-outline-variant/40 shadow-lg overflow-hidden">
          {gridActions(game.status).map((s) => (
            <button
              key={s}
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                onPick(game.id, s);
              }}
              className="w-full text-left px-3 py-2 text-xs font-semibold text-on-surface/80 hover:bg-accent/15 hover:text-accent transition-colors"
            >
              {GAME_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** HLTB playtime estimate, revealed on hover over the cover art. */
function HltbOverlay({ hours, label }: { hours: number; label: string }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex items-baseline gap-1.5 pl-2 pr-10 py-2 bg-black/75 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
      <span className="text-base font-bold text-accent leading-none">{formatHltbHours(hours)}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70 leading-none truncate">
        {label}
      </span>
    </div>
  );
}


function CompletionRing({ pct }: { pct: number }) {
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={36} height={36} className="absolute bottom-1 right-1" viewBox="0 0 36 36">
      <circle cx={18} cy={18} r={r} fill="rgba(0,0,0,0.6)" />
      <circle
        cx={18} cy={18} r={r}
        fill="none"
        stroke="rgb(var(--accent-rgb))"
        strokeWidth={3}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 18 18)"
      />
      <text x={18} y={22} textAnchor="middle" fontSize={8} fill="white" fontWeight="bold">
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

export function CoverCard({ game, showBadge = true, showReleaseDate = false, showHltb = false, onQuickStatus, onClick }: CoverCardProps) {
  const hasRing = game.completionPct !== null && game.completionPct > 0;
  const hltb = showHltb ? hltbEstimate(game) : null;

  // The menu holds <button>s, which can't legally nest inside the card's <a>,
  // so it sits alongside the link rather than inside it.
  const card = (
    <Link
      href={`/games/${game.id}`}
      onClick={onClick}
      className="block overflow-hidden bg-surface-container-low border border-outline-variant/20 hover:border-accent/40 transition-all duration-200 green-glow-hover"
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

        {/* Provisional badge */}
        {showBadge && game.matchStatus === "provisional" && (
          <div className="absolute top-1.5 left-1.5 bg-orange-500/90 text-white text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded">
            needs match
          </div>
        )}

        {/* Completion ring */}
        {hasRing && <CompletionRing pct={game.completionPct!} />}

        {/* HLTB estimate (hover) */}
        {hltb && <HltbOverlay hours={hltb.hours} label={hltb.label} />}
      </div>

      {/* Info bar */}
      <div className="px-2 py-2">
        <p className="text-sm font-semibold text-on-surface truncate leading-tight">{game.title}</p>
        {showReleaseDate && (
          <p className="text-sm text-on-surface/40 mt-0.5">
            {game.firstReleaseDate
              ? new Date(game.firstReleaseDate).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
              : "TBD"}
          </p>
        )}
      </div>
    </Link>
  );

  if (!onQuickStatus) return <div className="group relative">{card}</div>;

  return (
    <div className="group relative">
      {card}
      <QuickStatusMenu game={game} onPick={onQuickStatus} />
    </div>
  );
}
