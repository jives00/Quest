"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, type QuestList, type QuestListDetail, type LibraryGame } from "@/lib/api";
import { CoverCard } from "@/components/cover-card";
import { saveGameNavContext } from "@/lib/game-nav-context";

export const dynamic = "force-dynamic";

const SYSTEM_ICONS: Record<string, string> = {
  backlog: "queue",
  wishlist: "bookmark",
  replay: "replay",
};

const PLATFORM_ICONS: Record<string, string> = {
  steam: "desktop_windows",
  psn: "videogame_asset",
  xbox: "sports_esports",
  epic: "rocket_launch",
  gog: "folder_special",
  meta_quest: "visibility",
};

const DONE_STATUSES = new Set(["completed", "other"]);

export default function ListsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isLoading } = useAuth();
  const [lists, setLists] = useState<QuestList[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  function selectList(id: number) {
    setSelectedId(id);
    router.replace(`?list=${id}`);
  }
  const [detail, setDetail] = useState<QuestListDetail | null>(null);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Create/rename state
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  useEffect(() => {
    if (!token) return;
    api.getLists(token)
      .then((ls) => {
        setLists(ls);
        const urlId = searchParams.get("list") ? Number(searchParams.get("list")) : null;
        const target = urlId && ls.find((l) => l.id === urlId) ? urlId : ls[0]?.id ?? null;
        if (target !== null) setSelectedId(target);
      })
      .catch(() => console.error("Lists load error"))
      .finally(() => setLoadingLists(false));
  }, [token]);

  useEffect(() => {
    if (!token || !selectedId) return;
    setLoadingDetail(true);
    api.getListDetail(selectedId, token)
      .then(setDetail)
      .catch(() => console.error("List detail error"))
      .finally(() => setLoadingDetail(false));
  }, [token, selectedId]);

  const handleCreateList = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newName.trim()) return;
    const list = await api.createList(newName.trim(), token);
    setLists((prev) => [...prev, list]);
    setNewName("");
    setCreating(false);
    selectList(list.id);
  }, [token, newName]);

  const handleRenameList = useCallback(async (id: number) => {
    if (!token || !renameValue.trim()) return;
    const updated = await api.renameList(id, renameValue.trim(), token);
    setLists((prev) => prev.map((l) => (l.id === id ? updated : l)));
    if (detail?.list.id === id) setDetail((prev) => prev ? { ...prev, list: updated } : prev);
    setRenamingId(null);
  }, [token, renameValue, detail]);

  const handleDeleteList = useCallback(async (id: number) => {
    if (!token || !confirm("Delete this list?")) return;
    await api.deleteList(id, token);
    setLists((prev) => prev.filter((l) => l.id !== id));
    if (selectedId === id) {
      const remaining = lists.filter((l) => l.id !== id);
      const next = remaining[0]?.id ?? null;
      if (next !== null) selectList(next);
      else setSelectedId(null);
    }
  }, [token, lists, selectedId]);

  const handleRemoveFromBacklog = useCallback(async (gameId: number) => {
    if (!token || !selectedId) return;
    await api.removeListItem(selectedId, gameId, token);
    setDetail((prev) =>
      prev ? { ...prev, games: prev.games.filter((g) => g.id !== gameId) } : prev
    );
    setLists((prev) =>
      prev.map((l) => l.id === selectedId ? { ...l, itemCount: l.itemCount - 1 } : l)
    );
  }, [token, selectedId]);

  if (isLoading) return null;
  if (!token) return null;

  const systemLists = lists.filter((l) => l.kind === "system");
  const customLists = lists.filter((l) => l.kind === "custom");

  const selectedList = lists.find((l) => l.id === selectedId);
  const isBacklog = selectedList?.systemKey === "backlog";
  const isReadOnly = selectedList?.kind === "platform";

  return (
    <div className="flex flex-1 h-[calc(100vh-56px)]">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-surface-container-lowest border-r border-outline-variant/30 overflow-y-auto flex flex-col">
        <div className="p-4 border-b border-outline-variant/20">
          <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30">System</span>
        </div>
        <nav className="flex-1">
          {systemLists.map((l) => (
            <button
              key={l.id}
              onClick={() => selectList(l.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                selectedId === l.id
                  ? "bg-accent/10 text-accent border-r-2 border-accent"
                  : "text-on-surface/70 hover:bg-on-surface/5 hover:text-on-surface"
              }`}
            >
              <span className="material-symbols-outlined text-base shrink-0">
                {l.systemKey ? SYSTEM_ICONS[l.systemKey] ?? "list" : "list"}
              </span>
              <span className="text-sm font-medium truncate flex-1">{l.name}</span>
              <span className="text-[10px] text-on-surface/30">{l.itemCount}</span>
            </button>
          ))}

          <div className="px-4 py-2 mt-2 border-t border-outline-variant/20 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30">Custom</span>
            <button
              onClick={() => setCreating(true)}
              className="text-accent hover:text-accent-hover transition-colors"
              title="New list"
            >
              <span className="material-symbols-outlined text-base">add</span>
            </button>
          </div>

          {creating && (
            <form onSubmit={handleCreateList} className="px-4 pb-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="List name…"
                className="w-full bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-1.5 text-on-surface text-sm focus:outline-none focus:border-accent"
              />
              <div className="flex gap-1 mt-1">
                <button type="submit" className="px-2 py-1 rounded bg-accent text-white text-xs font-bold">Create</button>
                <button type="button" onClick={() => setCreating(false)} className="px-2 py-1 rounded bg-surface-container text-on-surface/50 text-xs">Cancel</button>
              </div>
            </form>
          )}

          {customLists.map((l) => (
            <div
              key={l.id}
              className={`group flex items-center gap-1 pr-2 ${selectedId === l.id ? "bg-accent/10 border-r-2 border-accent" : "hover:bg-on-surface/5"}`}
            >
              {renamingId === l.id ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); handleRenameList(l.id); }}
                  className="flex-1 px-3 py-2"
                >
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="w-full bg-surface-container border border-outline-variant/40 rounded px-2 py-0.5 text-on-surface text-sm focus:outline-none focus:border-accent"
                  />
                </form>
              ) : (
                <button
                  onClick={() => selectList(l.id)}
                  className={`flex-1 flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    selectedId === l.id ? "text-accent" : "text-on-surface/70 hover:text-on-surface"
                  }`}
                >
                  <span className="material-symbols-outlined text-base shrink-0">format_list_bulleted</span>
                  <span className="text-sm font-medium truncate flex-1">{l.name}</span>
                  <span className="text-[10px] text-on-surface/30">{l.itemCount}</span>
                </button>
              )}
              {renamingId !== l.id && (
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { setRenamingId(l.id); setRenameValue(l.name); }}
                    className="p-1 text-on-surface/30 hover:text-accent transition-colors"
                    title="Rename"
                  >
                    <span className="material-symbols-outlined text-sm">edit</span>
                  </button>
                  <button
                    onClick={() => handleDeleteList(l.id)}
                    className="p-1 text-on-surface/30 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {!selectedList ? (
          <div className="flex items-center justify-center h-full text-on-surface/30">
            <p>Select a list</p>
          </div>
        ) : (
          <div className="px-8 py-8">
            <div className="flex items-center gap-4 mb-8">
              <h1 className="text-h2 font-black tracking-tight text-on-surface flex-1">{selectedList.name}</h1>
              {isReadOnly && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30 border border-outline-variant/30 px-2 py-1 rounded">
                  Read-only
                </span>
              )}
            </div>

            {loadingDetail ? (
              <div className="flex items-center justify-center py-24">
                <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              </div>
            ) : !detail?.games.length ? (
              <div className="flex flex-col items-center justify-center py-24 gap-4">
                <span className="material-symbols-outlined text-5xl text-on-surface/20">sports_esports</span>
                <p className="text-on-surface/40">This list is empty.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                {detail.games.map((game) => {
                  const looksD = isBacklog && game.status && DONE_STATUSES.has(game.status);
                  return (
                    <div key={game.id} className="relative">
                      <CoverCard
                        game={game}
                        onClick={() => saveGameNavContext(detail.games.map((g) => g.id), selectedList?.name ?? "List")}
                      />
                      {looksD && (
                        <div className="absolute inset-0 flex flex-col items-center justify-end pb-2 bg-black/50">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-yellow-400 bg-black/60 px-1.5 py-0.5 rounded mb-1">
                            looks done
                          </span>
                          {!isReadOnly && (
                            <button
                              onClick={() => handleRemoveFromBacklog(game.id)}
                              className="text-[9px] font-bold uppercase tracking-widest text-white bg-red-500/80 hover:bg-red-600 px-2 py-0.5 rounded transition-colors"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
