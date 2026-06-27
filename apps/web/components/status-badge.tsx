import type { GameStatus } from "@/lib/api";

const STATUS_CONFIG: Record<GameStatus, { label: string; classes: string }> = {
  unplayed:  { label: "Unplayed",  classes: "bg-surface-container-high text-on-surface/60 border border-outline-variant/40" },
  playing:   { label: "Playing",   classes: "bg-accent/20 text-accent border border-accent/30" },
  completed: { label: "Completed", classes: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" },
  other:     { label: "Other",     classes: "bg-purple-500/20 text-purple-400 border border-purple-500/30" },
};

export function StatusBadge({ status }: { status: GameStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${cfg.classes}`}>
      {cfg.label}
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
  const statuses: GameStatus[] = ["unplayed", "playing", "completed", "other"];
  return (
    <div className="flex flex-wrap gap-2">
      {statuses.map((s) => (
        <button
          key={s}
          onClick={() => onChange(current === s ? null : s)}
          className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full transition-all ${
            current === s
              ? STATUS_CONFIG[s].classes + " ring-2 ring-offset-1 ring-offset-background ring-current"
              : "bg-surface-container-high text-on-surface/40 hover:text-on-surface border border-outline-variant/30"
          }`}
        >
          {STATUS_CONFIG[s].label}
        </button>
      ))}
    </div>
  );
}
