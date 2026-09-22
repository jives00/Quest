import { GAME_STATUSES, GAME_STATUS_LABELS } from "@quest/types";
import type { GameStatus } from "@/lib/api";

const STATUS_CLASSES: Record<GameStatus, string> = {
  wishlist:  "bg-pink-500/20 text-pink-400 border border-pink-500/30",
  backlog:   "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  playing:   "bg-accent/20 text-accent border border-accent/30",
  completed: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
  skipped:   "bg-surface-container-high text-on-surface/50 border border-outline-variant/40",
};

export { GAME_STATUS_LABELS as STATUS_LABELS };

export function StatusBadge({ status }: { status: GameStatus }) {
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${STATUS_CLASSES[status]}`}>
      {GAME_STATUS_LABELS[status]}
    </span>
  );
}

export function StatusSelector({
  current,
  onChange,
}: {
  current: GameStatus | null;
  onChange: (status: GameStatus | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {GAME_STATUSES.map((s) => (
        <button
          key={s}
          onClick={() => onChange(current === s ? null : s)}
          className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full transition-all ${
            current === s
              ? STATUS_CLASSES[s] + " ring-2 ring-offset-1 ring-offset-background ring-current"
              : "bg-surface-container-high text-on-surface/40 hover:text-on-surface border border-outline-variant/30"
          }`}
        >
          {GAME_STATUS_LABELS[s]}
        </button>
      ))}
    </div>
  );
}
