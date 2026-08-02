"use client";

import { useState } from "react";
import { api, type GameDetail, type IgdbSearchResult } from "@/lib/api";
import { ModalShell } from "./game-metadata-editor";

export function GameRematch({
  game,
  token,
  onClose,
  onRematched,
}: {
  game: GameDetail;
  token: string;
  onClose: () => void;
  onRematched: (updated: GameDetail) => void;
}) {
  const [query, setQuery] = useState(game.title);
  const [results, setResults] = useState<IgdbSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [igdbIdInput, setIgdbIdInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    if (!query.trim()) return;
    setBusy(true);
    setError("");
    try {
      setResults(await api.searchGames(query.trim(), token));
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function rematch(igdbId: number) {
    if (!igdbId || igdbId <= 0) {
      setError("Enter a valid IGDB ID.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await api.rematchGame(game.id, igdbId, token);
      onRematched(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rematch failed.");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent";

  return (
    <ModalShell title="Fix match" onClose={onClose}>
      <p className="text-sm text-on-surface/50 mb-4">
        Search IGDB for the correct game, or enter its IGDB ID directly. This overwrites IGDB-sourced
        metadata; your custom artwork and tags are kept.
        {game.igdbId != null && <span className="block mt-1 text-on-surface/30">Currently matched to IGDB #{game.igdbId}</span>}
      </p>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {/* Direct IGDB ID */}
      <div className="flex gap-2 mb-5">
        <input
          type="number"
          value={igdbIdInput}
          onChange={(e) => setIgdbIdInput(e.target.value)}
          placeholder="IGDB ID"
          className={`${inputCls} w-36`}
        />
        <button
          onClick={() => rematch(Number(igdbIdInput))}
          disabled={busy || !igdbIdInput.trim()}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          Match by ID
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search IGDB…"
          className={`${inputCls} flex-1`}
        />
        <button
          onClick={search}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-accent/15 text-accent text-sm font-bold hover:bg-accent/25 disabled:opacity-50"
        >
          {busy ? "…" : "Search"}
        </button>
      </div>

      <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto">
        {results.map((r) => (
          <button
            key={r.igdbId}
            onClick={() => rematch(r.igdbId)}
            disabled={busy}
            className="flex items-center gap-3 text-left p-2 rounded-lg hover:bg-surface-container transition-colors disabled:opacity-50"
          >
            {r.coverUrl ? (
              <img src={r.coverUrl} alt="" className="w-10 h-[52px] object-cover shrink-0" />
            ) : (
              <div className="w-10 h-[52px] bg-surface-container shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-base text-on-surface leading-tight">{r.name}</p>
              <p className="text-xs text-on-surface/40 mt-0.5">
                {[r.year, r.platforms?.join(", ")].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span className="text-[10px] text-on-surface/30 shrink-0">#{r.igdbId}</span>
          </button>
        ))}
        {searched && results.length === 0 && !busy && (
          <p className="text-sm text-on-surface/40">No results.</p>
        )}
      </div>
    </ModalShell>
  );
}
