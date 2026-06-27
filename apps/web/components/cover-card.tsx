import Link from "next/link";
import type { LibraryGame } from "@/lib/api";

interface CoverCardProps {
  game: LibraryGame;
  showBadge?: boolean;
  showReleaseDate?: boolean;
  onClick?: () => void;
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

export function CoverCard({ game, showBadge = true, showReleaseDate = false, onClick }: CoverCardProps) {
  const hasRing = game.completionPct !== null && game.completionPct > 0;

  return (
    <Link
      href={`/games/${game.id}`}
      onClick={onClick}
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

        {/* Provisional badge */}
        {showBadge && game.matchStatus === "provisional" && (
          <div className="absolute top-1.5 left-1.5 bg-orange-500/90 text-white text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded">
            needs match
          </div>
        )}

        {/* Completion ring */}
        {hasRing && <CompletionRing pct={game.completionPct!} />}
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
}
