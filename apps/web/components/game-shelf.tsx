"use client";

import { useEffect, useState } from "react";
import { GAME_STATUSES, GAME_STATUS_LABELS } from "@quest/types";
import { api, type GameCompletion, type GameStatus, type QuestList } from "@/lib/api";

/**
 * The Shelf block: the one place that answers "where does this game sit in my
 * life right now" — its status, and every list it's on.
 *
 * Status and the list chips used to render ~220 lines apart, so changing the
 * status meant scrolling down to un-check a list. Backlog and Wishlist are
 * statuses now, which removes most of that by construction; the rest is fixed
 * by putting the lists here too.
 *
 * There are no separate action buttons. Every one of them ("Mark completed",
 * "Queue for replay") was a setStatus call the status rows already make in one
 * click — the same control drawn twice. Completions are dated rows independent
 * of status, so moving a finished game back to Backlog for a replay keeps its
 * completion history; the summary line above carries it.
 *
 * Radio rows for status (exactly one), checkbox rows for lists (any number).
 */

function completionSummary(completions: GameCompletion[]): string | null {
  if (completions.length === 0) return null;
  const years = completions
    .map((c) => new Date(c.completedAt).getUTCFullYear())
    .sort((a, b) => a - b);
  const times = completions.length === 1 ? "Completed once" : `Completed ${completions.length}×`;
  const span =
    years[0] === years[years.length - 1] ? `${years[0]}` : `${years[0]}–${years[years.length - 1]}`;
  return `${times} · ${span}`;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40 mb-2">
      {children}
    </p>
  );
}

interface Props {
  gameId: number;
  token: string;
  status: GameStatus | null;
  lists: QuestList[];
  memberOf: number[];
  refreshKey: number;
  onStatusChange: (status: GameStatus | null) => void;
  onListToggle: (listId: number, inList: boolean) => void;
}

export function GameShelf({
  gameId,
  token,
  status,
  lists,
  memberOf,
  refreshKey,
  onStatusChange,
  onListToggle,
}: Props) {
  const [completions, setCompletions] = useState<GameCompletion[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    api.getCompletions(gameId, token, ctrl.signal).then(setCompletions).catch(() => {});
    return () => ctrl.abort();
  }, [gameId, token, refreshKey]);

  const summary = completionSummary(completions);

  // VR is toggled by its own button and platform lists are derived from
  // ownership, so neither belongs among things you choose.
  const shelfLists = lists.filter(
    (l) => l.kind === "custom" || (l.kind === "system" && l.systemKey !== "vr"),
  );

  return (
    <section className="glass-panel p-5 flex flex-col gap-5">
      <div>
        <h3 className="text-label-sm font-bold uppercase tracking-widest text-on-surface/40">
          Shelf
        </h3>
        {/* Only what the controls below don't already say. The status is not
            repeated here — its row is already marked as the selected one. */}
        {summary && <p className="text-sm text-on-surface/60 mt-1">{summary}</p>}
      </div>

      {/* Status and Lists sit side by side, so the block is only as tall as the
          longer of the two rather than both stacked. Each column is roughly
          half a third-width sidebar, so both labels truncate. */}
      <div className={shelfLists.length > 0 ? "grid grid-cols-2 gap-4 items-start" : ""}>
        {/* ── Status: exactly one ── */}
        <div className="min-w-0">
          <GroupLabel>Status</GroupLabel>
          <div className="flex flex-col gap-1">
            {GAME_STATUSES.map((s) => {
              const selected = status === s;
              return (
                <button
                  key={s}
                  onClick={() => onStatusChange(selected ? null : s)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                    selected
                      ? "bg-accent/20 border border-accent/40"
                      : "bg-surface-container border border-transparent hover:border-outline-variant/40"
                  }`}
                >
                  <span
                    className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      selected ? "border-accent" : "border-on-surface/25"
                    }`}
                  >
                    {selected && <span className="w-2 h-2 rounded-full bg-accent" />}
                  </span>
                  <span
                    className={`text-sm font-semibold truncate ${selected ? "text-accent" : "text-on-surface/70"}`}
                  >
                    {GAME_STATUS_LABELS[s]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Lists: any number. Classification, never status. ── */}
        {shelfLists.length > 0 && (
          <div className="min-w-0">
            <GroupLabel>Lists</GroupLabel>
            <div className="flex flex-col gap-1">
              {shelfLists.map((l) => {
                const inList = memberOf.includes(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => onListToggle(l.id, inList)}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                      inList
                        ? "bg-accent/20 border border-accent/40"
                        : "bg-surface-container border border-transparent hover:border-outline-variant/40"
                    }`}
                  >
                    <span
                      className={`shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${
                        inList ? "border-accent bg-accent" : "border-on-surface/25"
                      }`}
                    >
                      {inList && (
                        <span
                          className="material-symbols-outlined text-on-primary"
                          style={{ fontSize: "12px" }}
                        >
                          check
                        </span>
                      )}
                    </span>
                    <span
                      className={`text-sm font-semibold truncate ${inList ? "text-accent" : "text-on-surface/70"}`}
                      title={l.name}
                    >
                      {l.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
