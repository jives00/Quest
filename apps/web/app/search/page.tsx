"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, type IgdbSearchResult } from "@/lib/api";

export const dynamic = "force-dynamic";

export default function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isLoading } = useAuth();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [results, setResults] = useState<IgdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [navigating, setNavigating] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  useEffect(() => {
    const q = searchParams.get("q");
    if (!q || !token) return;
    setQuery(q);
    setSearching(true);
    api.searchGames(q, token)
      .then(setResults)
      .catch((err) => console.error("Search error:", err))
      .finally(() => setSearching(false));
  }, [searchParams, token]);

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    if (!token || !query.trim()) return;
    setSearching(true);
    try {
      setResults(await api.searchGames(query.trim(), token));
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setSearching(false);
    }
  }

  async function openGame(result: IgdbSearchResult) {
    if (!token || navigating !== null) return;
    setNavigating(result.igdbId);
    try {
      const { id } = await api.addGame(result.igdbId, token);
      router.push(`/games/${id}`);
    } catch (err) {
      console.error("Add game error:", err);
      setNavigating(null);
    }
  }

  if (isLoading || !token) return null;

  return (
    <div className="flex flex-col flex-1">
      <section className="bg-surface-container-lowest px-margin-page py-10">
        <div className="max-w-page mx-auto">
          <h1 className="text-h1 font-black tracking-tight text-on-surface mb-6">Add Game</h1>
          <form onSubmit={runSearch} className="flex gap-3 max-w-xl">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search IGDB for a game…"
              className="flex-1 bg-surface-container border border-outline-variant/40 rounded-lg px-4 py-2.5 text-on-surface text-sm focus:outline-none focus:border-accent transition-colors"
            />
            <button
              type="submit"
              disabled={searching}
              className="px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </form>
        </div>
      </section>

      <div className="max-w-page mx-auto px-margin-page py-stack-lg w-full">
        {results.length === 0 ? (
          <p className="text-on-surface/40 text-sm">Search for a game to add it to a list or mark it owned.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {results.map((r) => (
              <button
                key={r.igdbId}
                onClick={() => openGame(r)}
                disabled={navigating !== null}
                className="text-left overflow-hidden bg-surface-container-low border border-outline-variant/20 hover:border-accent/40 transition-colors disabled:opacity-60"
              >
                <div className="aspect-[264/374] bg-surface-container">
                  {r.coverUrl ? (
                    <img src={r.coverUrl} alt={r.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-on-surface/20">No art</div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs font-semibold text-on-surface truncate">{r.name}</p>
                  <p className="text-[10px] text-on-surface/40">{r.year ?? "—"}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
