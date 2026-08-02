"use client";

import { useEffect, useRef, useState } from "react";
import { api, type GameCompletion, type GameStatus } from "@/lib/api";

// Completion dates are date-only values stored as UTC midnight, and the year
// stats bucket them with a raw YEAR(completed_at) -- no timezone conversion. So
// they have to render in UTC too; formatting in local time pulls a Jan 1 entry
// back to Dec 31 for UTC-offset users and makes the game look like it belongs
// to the previous year. Matches fmtDateOnly in app/stats/page.tsx.
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function sourceLabel(source: GameCompletion["source"]): string {
  return source === "status_change" ? "via status" : "manual";
}

interface Props {
  gameId: number;
  token: string;
  status: GameStatus | null;
  refreshKey: number;
}

export function GameCompletionsCard({ gameId, token, status, refreshKey }: Props) {
  const [completions, setCompletions] = useState<GameCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickedDate, setPickedDate] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    api
      .getCompletions(gameId, token, ctrl.signal)
      .then(setCompletions)
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [gameId, token, refreshKey]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setShowDatePicker(false);
        setPickedDate("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const visible = status === "completed" || completions.length > 0;
  if (!visible && !loading) return null;

  async function handleAddToday() {
    setDropdownOpen(false);
    setAdding(true);
    try {
      const entry = await api.addCompletion(gameId, null, token);
      setCompletions((prev) => [entry, ...prev]);
    } catch {
      /* ignore */
    } finally {
      setAdding(false);
    }
  }

  async function handleAddPickedValue(date: string) {
    setDropdownOpen(false);
    setShowDatePicker(false);
    setPickedDate("");
    setAdding(true);
    try {
      const entry = await api.addCompletion(gameId, date + "T12:00:00", token);
      setCompletions((prev) => [entry, ...prev].sort((a, b) => b.completedAt.localeCompare(a.completedAt)));
    } catch {
      /* ignore */
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: number) {
    try {
      await api.deleteCompletion(id, token);
      setCompletions((prev) => prev.filter((c) => c.id !== id));
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="glass-panel rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40">
          Completions
        </h3>

        <div className="relative" ref={dropdownRef}>
          <button
            disabled={adding}
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-1 text-xs font-bold text-accent hover:text-accent/80 disabled:opacity-40 transition-colors"
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>add</span>
            Add
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-6 z-20 w-44 rounded-xl bg-surface-container border border-outline-variant/30 shadow-lg overflow-hidden">
              <button
                onClick={handleAddToday}
                className="w-full text-left px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-high transition-colors"
              >
                Today
              </button>
              {!showDatePicker ? (
                <button
                  onClick={() => setShowDatePicker(true)}
                  className="w-full text-left px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-high transition-colors"
                >
                  Pick date…
                </button>
              ) : (
                <div className="px-4 py-2.5">
                  <input
                    type="date"
                    value={pickedDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => {
                      setPickedDate(e.target.value);
                      if (e.target.value) handleAddPickedValue(e.target.value);
                    }}
                    className="w-full bg-surface-container-high border border-outline-variant/40 rounded px-2 py-1 text-sm text-on-surface focus:outline-none focus:border-accent"
                    autoFocus
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-on-surface/40 text-sm">
          <div className="w-3.5 h-3.5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          Loading…
        </div>
      ) : completions.length === 0 ? (
        <p className="text-sm text-on-surface/30 italic">No completions yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {completions.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-on-surface">{formatDate(c.completedAt)}</p>
                <p className="text-[10px] uppercase tracking-widest text-on-surface/30">
                  {sourceLabel(c.source)}
                </p>
              </div>
              <button
                onClick={() => handleDelete(c.id)}
                title="Remove completion"
                className="text-on-surface/30 hover:text-red-400 transition-colors"
              >
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>close</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
