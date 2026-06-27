"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type TimelineItem,
  type HistoryPrecision,
  type HistoryStatus,
} from "@/lib/api";

// Unified per-game play history: mined sessions + achievement-day clusters + status
// terminal markers + manually-entered "memories" (for games with no API trace).

const KIND_ICON: Record<string, string> = {
  session: "schedule",
  achievement: "trophy",
  manual: "bookmark",
  status: "flag",
};

function fmtDate(at: string | null, precision: HistoryPrecision | null): string {
  if (!at) return "Sometime";
  const d = new Date(at);
  if (isNaN(d.getTime())) return at;
  if (precision === "year") return String(d.getFullYear());
  if (precision === "month") return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  return `${(min / 60).toFixed(1)}h`;
}

function describe(item: TimelineItem): string {
  switch (item.kind) {
    case "session":
      return `Played ${fmtMinutes(item.value ?? 0)}${item.source ? ` · ${item.source}` : ""}`;
    case "achievement":
      return `${item.value} achievement${item.value === 1 ? "" : "s"} unlocked`;
    case "status":
      return `Marked ${item.status}`;
    case "manual":
      return [item.status, item.source, item.note].filter(Boolean).join(" · ") || "Played";
  }
}

export function GameHistory({ gameId, token }: { gameId: number; token: string }) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(() => {
    api.getTimeline(gameId, token).then(setItems).catch((e) => console.error("Timeline error:", e));
  }, [gameId, token]);

  useEffect(reload, [reload]);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="block w-8 h-1 bg-accent rounded mb-2" />
          <h2 className="text-h2 font-black tracking-tight text-on-surface">History</h2>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
        >
          {adding ? "Cancel" : "Add memory"}
        </button>
      </div>

      {adding && (
        <AddMemoryForm
          gameId={gameId}
          token={token}
          onAdded={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

      {items.length === 0 ? (
        <p className="text-on-surface/40 text-sm">
          No history yet — play the game, or add a memory for when you played it historically.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((item, i) => (
            <li
              key={`${item.kind}-${item.manualId ?? i}`}
              className="flex items-center gap-3 bg-surface-container-low rounded-lg border border-outline-variant/20 px-4 py-2.5"
            >
              <span className="material-symbols-outlined text-on-surface/40 text-[20px]">{KIND_ICON[item.kind]}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-on-surface truncate">{describe(item)}</p>
                <p className="text-[11px] text-on-surface/40">{fmtDate(item.at, item.precision)}</p>
              </div>
              {item.kind === "manual" && item.manualId != null && (
                <button
                  onClick={async () => {
                    await api.deleteHistory(item.manualId!, token);
                    reload();
                  }}
                  className="material-symbols-outlined text-on-surface/30 hover:text-red-400 text-[18px] transition-colors"
                  title="Delete memory"
                >
                  delete
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AddMemoryForm({ gameId, token, onAdded }: { gameId: number; token: string; onAdded: () => void }) {
  const [precision, setPrecision] = useState<HistoryPrecision>("year");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<HistoryStatus | "">("");
  const [platform, setPlatform] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      // Normalize the entered value to a date the API can store regardless of precision.
      let occurredStart: string | null = null;
      if (date) {
        if (precision === "year" && /^\d{4}$/.test(date)) occurredStart = `${date}-01-01`;
        else if (precision === "month" && /^\d{4}-\d{2}$/.test(date)) occurredStart = `${date}-01`;
        else occurredStart = date;
      }
      await api.createHistory(
        {
          gameId,
          occurredStart,
          precision,
          status: status || null,
          platform: platform || null,
          note: note || null,
        },
        token,
      );
      onAdded();
    } catch (err) {
      console.error("Create memory error:", err);
    } finally {
      setBusy(false);
    }
  }

  const datePlaceholder =
    precision === "year" ? "2008" : precision === "month" ? "2008-06" : "2008-06-21";

  return (
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/20 p-4 mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(["exact", "day", "month", "year", "era"] as HistoryPrecision[]).map((p) => (
          <button
            key={p}
            onClick={() => setPrecision(p)}
            className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded ${
              precision === p ? "bg-accent/20 text-accent" : "text-on-surface/40 hover:text-on-surface"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {precision !== "era" && (
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder={datePlaceholder}
            className="flex-1 min-w-[8rem] bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent"
          />
        )}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as HistoryStatus | "")}
          className="bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent"
        >
          <option value="">— status —</option>
          <option value="playing">Playing</option>
          <option value="completed">Completed</option>
          <option value="other">Other</option>
        </select>
        <input
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          placeholder="platform (e.g. Xbox 360)"
          className="flex-1 min-w-[8rem] bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent"
        />
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Note (optional) — e.g. “beat it at a friend’s house”"
        className="w-full bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent resize-y"
      />
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save memory"}
        </button>
      </div>
    </div>
  );
}
