import type { LibraryGame } from "@/lib/api";
import { saveGameNavContext } from "@/lib/game-nav-context";
import { CoverCard } from "./cover-card";

interface CoverGridProps {
  games: LibraryGame[];
  showBadge?: boolean;
  showReleaseDate?: boolean;
  emptyMessage?: string;
  navLabel?: string;
  gridClass?: string;
}

export function CoverGrid({ games, showBadge = true, showReleaseDate = false, emptyMessage = "No games found.", navLabel, gridClass }: CoverGridProps) {
  if (games.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <span className="material-symbols-outlined text-5xl text-on-surface/20">sports_esports</span>
        <p className="text-on-surface/40 text-body-md">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={gridClass ?? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3"}>
      {games.map((game) => (
        <CoverCard
          key={game.id}
          game={game}
          showBadge={showBadge}
          showReleaseDate={showReleaseDate}
          onClick={navLabel ? () => saveGameNavContext(games.map((g) => g.id), navLabel) : undefined}
        />
      ))}
    </div>
  );
}
