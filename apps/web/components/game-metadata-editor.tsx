"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, type GameDetail, type ArtworkCandidates } from "@/lib/api";

function csv(arr: string[]): string {
  return arr.join(", ");
}
function parseCsv(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
function deriveSortTitle(t: string): string {
  return t.replace(/^(the|a|an)\s+/i, "").trim();
}

function extractYouTubeId(input: string): string {
  const s = input.trim();
  // youtu.be/ID or youtube.com/watch?v=ID or youtube.com/embed/ID
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/)([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  // bare 11-char ID
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return s;
}

function extractIgdbImageId(input: string): string {
  const s = input.trim();
  // https://images.igdb.com/igdb/image/upload/t_xxx/IMAGE_ID.jpg
  const m = s.match(/\/([a-zA-Z0-9_]+)\.jpg$/);
  if (m) return m[1];
  return s;
}

export function GameMetadataEditor({
  game,
  token,
  onClose,
  onSaved,
  onOpenRematch,
}: {
  game: GameDetail;
  token: string;
  onClose: () => void;
  onSaved: (updated: GameDetail) => void;
  onOpenRematch: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"details" | "artwork" | "media">("details");

  // Action toggle state
  const [vrToggling, setVrToggling] = useState(false);
  const [hidingToggle, setHidingToggle] = useState(false);
  const [vrSupported, setVrSupported] = useState(game.vrSupported);
  const [hidden, setHidden] = useState(game.hidden);

  async function handleVrToggle() {
    setVrToggling(true);
    try {
      const updated = await api.setVr(game.id, !vrSupported, token);
      setVrSupported(updated.vrSupported);
      onSaved(updated);
    } catch (err) {
      console.error("VR toggle error:", err);
    } finally {
      setVrToggling(false);
    }
  }

  async function handleHideToggle() {
    setHidingToggle(true);
    try {
      const updated = await api.setHidden(game.id, !hidden, token);
      setHidden(updated.hidden);
      onSaved(updated);
    } catch (err) {
      console.error("Hide toggle error:", err);
    } finally {
      setHidingToggle(false);
    }
  }

  // Details fields
  const [title, setTitle] = useState(game.title);
  const [sortTitle, setSortTitle] = useState(game.sortTitle ?? game.title);
  const [summary, setSummary] = useState(game.summary ?? "");
  const [releaseDate, setReleaseDate] = useState(game.firstReleaseDate?.slice(0, 10) ?? "");
  const [genres, setGenres] = useState(csv(game.genres));
  const [tags, setTags] = useState(csv(game.tags));
  const [metacritic, setMetacritic] = useState(game.metacritic?.toString() ?? "");
  const [hltb, setHltb] = useState(game.hltbMainHours?.toString() ?? "");

  // Artwork fields
  const [coverPath, setCoverPath] = useState(game.coverPath ?? "");
  const [heroPath, setHeroPath] = useState(game.heroPath ?? "");

  // Media fields
  const [trailerInput, setTrailerInput] = useState(game.trailerVideoIds[0] ?? "");
  const [screenshotIds, setScreenshotIds] = useState<string[]>(game.screenshotImageIds);
  const [screenshotInput, setScreenshotInput] = useState("");
  const [art, setArt] = useState<ArtworkCandidates | null>(null);
  const [artQuery, setArtQuery] = useState(game.title);
  const [artLoading, setArtLoading] = useState(false);

  // Actions
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadArt = useCallback(
    async (q?: string) => {
      setArtLoading(true);
      try {
        setArt(await api.getArtwork(game.id, token, q));
      } catch (err) {
        console.error("Artwork load error:", err);
      } finally {
        setArtLoading(false);
      }
    },
    [game.id, token]
  );

  useEffect(() => {
    void loadArt();
  }, [loadArt]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteGame(game.id, token);
      onClose();
      router.push("/library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const updated = await api.updateGameMetadata(
        game.id,
        {
          title: title.trim(),
          sortTitle: sortTitle.trim() || null,
          summary: summary.trim() || null,
          firstReleaseDate: releaseDate || null,
          genres: parseCsv(genres),
          tags: parseCsv(tags),
          metacritic: metacritic.trim() ? Number(metacritic) : null,
          hltbMainHours: hltb.trim() ? Number(hltb) : null,
          coverPath: coverPath.trim() || null,
          heroPath: heroPath.trim() || null,
          trailerVideoIds: trailerInput.trim() ? [extractYouTubeId(trailerInput.trim())] : [],
          screenshotImageIds: screenshotIds,
        },
        token
      );
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent";
  const labelCls = "text-[10px] font-bold uppercase tracking-widest text-on-surface/40 block mb-1";
  const tabCls = (active: boolean) =>
    `px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-lg transition-colors ${
      active ? "bg-accent text-white" : "text-on-surface/50 hover:text-on-surface"
    }`;

  return (
    <ModalShell title="Edit game" onClose={onClose} wide>
      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {/* Tabs */}
      <div className="flex gap-1 mb-5">
        <button className={tabCls(tab === "details")} onClick={() => setTab("details")}>Details</button>
        <button className={tabCls(tab === "artwork")} onClick={() => setTab("artwork")}>Artwork</button>
        <button className={tabCls(tab === "media")} onClick={() => setTab("media")}>Media</button>
      </div>

      {tab === "details" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Sort title</label>
            <div className="flex gap-2">
              <input
                value={sortTitle}
                onChange={(e) => setSortTitle(e.target.value)}
                className={inputCls}
                placeholder="Controls alphabetical sort order"
              />
              <button
                type="button"
                onClick={() => setSortTitle(deriveSortTitle(title))}
                title="Strip leading article (The, A, An)"
                className="px-3 py-2 rounded-lg text-xs text-on-surface/50 hover:text-on-surface border border-outline-variant/40 shrink-0 transition-colors"
              >
                Auto
              </button>
            </div>
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Description</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={5} className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className={labelCls}>Release date</label>
            <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Metacritic</label>
              <input type="number" min={0} max={100} value={metacritic} onChange={(e) => setMetacritic(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Hours to beat</label>
              <input type="number" min={0} step="0.5" value={hltb} onChange={(e) => setHltb(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Genres (comma-separated)</label>
            <input value={genres} onChange={(e) => setGenres(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tags (comma-separated)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} className={inputCls} />
          </div>
        </div>
      )}

      {tab === "artwork" && (
        <div className="flex flex-col gap-6">
          {/* Artwork search */}
          <div className="flex items-center gap-2">
            <input
              value={artQuery}
              onChange={(e) => setArtQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void loadArt(artQuery.trim())}
              placeholder="Search artwork by title…"
              className="flex-1 bg-surface-container border border-outline-variant/40 rounded-lg px-3 py-2 text-on-surface text-sm focus:outline-none focus:border-accent"
            />
            <button
              onClick={() => void loadArt(artQuery.trim())}
              disabled={artLoading}
              className="px-4 py-2 rounded-lg bg-accent/15 text-accent text-sm font-bold hover:bg-accent/25 disabled:opacity-50 shrink-0"
            >
              {artLoading ? "Searching…" : "Search"}
            </button>
          </div>

          {/* Cover */}
          <div>
            <label className={labelCls}>Cover art (box / portrait)</label>
            <div className="flex gap-4 mb-3">
              {coverPath ? (
                <img src={coverPath} alt="" className="w-24 aspect-[264/374] object-cover rounded-lg shrink-0 shadow-lg" />
              ) : (
                <div className="w-24 aspect-[264/374] rounded-lg bg-surface-container shrink-0" />
              )}
              <div className="flex-1 flex flex-col gap-2">
                <input
                  value={coverPath}
                  onChange={(e) => setCoverPath(e.target.value)}
                  placeholder="Paste image URL…"
                  className={inputCls}
                />
                {coverPath && (
                  <button
                    onClick={() => setCoverPath("")}
                    className="text-xs text-on-surface/40 hover:text-red-400 text-left transition-colors"
                  >
                    Clear cover
                  </button>
                )}
              </div>
            </div>
            {art && art.grids.length > 0 && (
              <div className="grid grid-cols-6 gap-2 max-h-80 overflow-y-auto pr-1">
                {art.grids.map((url) => (
                  <button
                    key={url}
                    onClick={() => setCoverPath(url)}
                    className={`rounded-lg overflow-hidden border-2 transition-all ${
                      coverPath === url ? "border-accent scale-[0.97]" : "border-transparent hover:border-outline-variant"
                    }`}
                  >
                    <img src={url} alt="" className="w-full aspect-[264/374] object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
            {art && art.grids.length === 0 && !artLoading && (
              <p className="text-xs text-on-surface/40 mt-1">No cover art found — paste a URL above or try a different search.</p>
            )}
          </div>

          {/* Hero */}
          <div>
            <label className={labelCls}>Hero banner (wide / landscape)</label>
            <div className="mb-3">
              {heroPath ? (
                <img src={heroPath} alt="" className="w-full aspect-[16/5] object-cover rounded-lg shadow-lg mb-2" />
              ) : (
                <div className="w-full aspect-[16/5] rounded-lg bg-surface-container mb-2" />
              )}
              <div className="flex gap-2">
                <input
                  value={heroPath}
                  onChange={(e) => setHeroPath(e.target.value)}
                  placeholder="Paste image URL…"
                  className={inputCls}
                />
                {heroPath && (
                  <button
                    onClick={() => setHeroPath("")}
                    className="px-3 py-2 rounded-lg text-xs text-on-surface/40 hover:text-red-400 border border-outline-variant/20 transition-colors shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            {art && art.heroes.length > 0 && (
              <div className="grid grid-cols-3 gap-3 max-h-80 overflow-y-auto pr-1">
                {art.heroes.map((url) => (
                  <button
                    key={url}
                    onClick={() => setHeroPath(url)}
                    className={`rounded-lg overflow-hidden border-2 transition-all ${
                      heroPath === url ? "border-accent scale-[0.98]" : "border-transparent hover:border-outline-variant"
                    }`}
                  >
                    <img src={url} alt="" className="w-full aspect-[16/5] object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
            {art && art.heroes.length === 0 && !artLoading && (
              <p className="text-xs text-on-surface/40 mt-1">No hero art found — paste a URL above or try a different search.</p>
            )}
          </div>
        </div>
      )}

      {tab === "media" && (
        <div className="flex flex-col gap-8">
          {/* Trailer */}
          <div>
            <label className={labelCls}>YouTube trailer</label>
            <p className="text-xs text-on-surface/40 mb-2">Paste a YouTube URL or video ID (e.g. youtu.be/abc123 or watch?v=abc123)</p>
            <input
              value={trailerInput}
              onChange={(e) => setTrailerInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              className={inputCls}
            />
            {trailerInput.trim() && (
              <div className="relative w-full rounded-xl overflow-hidden mt-3" style={{ aspectRatio: "16/9" }}>
                <iframe
                  key={extractYouTubeId(trailerInput.trim())}
                  src={`https://www.youtube.com/embed/${extractYouTubeId(trailerInput.trim())}`}
                  title="Trailer preview"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full"
                />
              </div>
            )}
            {trailerInput.trim() && (
              <button
                onClick={() => setTrailerInput("")}
                className="mt-2 text-xs text-on-surface/40 hover:text-red-400 transition-colors"
              >
                Remove trailer
              </button>
            )}
          </div>

          {/* Screenshots */}
          <div>
            <label className={labelCls}>Screenshots</label>
            <p className="text-xs text-on-surface/40 mb-3">Paste an IGDB image URL or image ID to add. Click a screenshot to remove it.</p>
            {screenshotIds.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-4">
                {screenshotIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => setScreenshotIds((prev) => prev.filter((s) => s !== id))}
                    title="Click to remove"
                    className="relative group rounded-lg overflow-hidden shrink-0"
                  >
                    <img
                      src={`https://images.igdb.com/igdb/image/upload/t_screenshot_med/${id}.jpg`}
                      alt=""
                      className="h-28 w-auto object-cover group-hover:opacity-50 transition-opacity"
                      loading="lazy"
                    />
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="material-symbols-outlined text-white text-2xl drop-shadow">delete</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={screenshotInput}
                onChange={(e) => setScreenshotInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && screenshotInput.trim()) {
                    const id = extractIgdbImageId(screenshotInput.trim());
                    if (id && !screenshotIds.includes(id)) setScreenshotIds((prev) => [...prev, id]);
                    setScreenshotInput("");
                  }
                }}
                placeholder="https://images.igdb.com/igdb/image/upload/t_screenshot_big/IMAGE_ID.jpg"
                className={inputCls}
              />
              <button
                onClick={() => {
                  const id = extractIgdbImageId(screenshotInput.trim());
                  if (id && !screenshotIds.includes(id)) setScreenshotIds((prev) => [...prev, id]);
                  setScreenshotInput("");
                }}
                disabled={!screenshotInput.trim()}
                className="px-4 py-2 rounded-lg bg-accent/15 text-accent text-sm font-bold hover:bg-accent/25 disabled:opacity-40 shrink-0"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-outline-variant/20 flex flex-col gap-3">
        {/* Game actions */}
        <div className="flex gap-2">
          <button
            onClick={handleVrToggle}
            disabled={vrToggling}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 ${
              vrSupported
                ? "bg-accent/20 text-accent border-accent/30"
                : "bg-surface-container text-on-surface/60 border-outline-variant/40 hover:text-on-surface"
            }`}
            title={vrSupported ? "Mark as non-VR" : "Mark as VR"}
          >
            <span className="material-symbols-outlined text-sm">vrpano</span>
            {vrToggling ? "…" : "VR"}
          </button>
          <button
            onClick={handleHideToggle}
            disabled={hidingToggle}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-widest transition-colors disabled:opacity-50 ${
              hidden
                ? "bg-accent/20 text-accent border-accent/30"
                : "bg-surface-container text-on-surface/60 border-outline-variant/40 hover:text-on-surface"
            }`}
            title={hidden ? "Unhide game" : "Hide game"}
          >
            <span className="material-symbols-outlined text-sm">
              {hidden ? "visibility" : "visibility_off"}
            </span>
            {hidingToggle ? "…" : hidden ? "Unhide" : "Hide"}
          </button>
          <button
            onClick={() => { onClose(); onOpenRematch(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container text-on-surface/60 hover:text-on-surface border border-outline-variant/40 text-xs font-bold uppercase tracking-widest transition-colors"
            title="Fix the IGDB match for this game"
          >
            <span className="material-symbols-outlined text-sm">sync_problem</span>
            Fix match
          </button>
        </div>

        {/* Save / Cancel / Delete */}
        <div className="flex gap-2 items-center">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-surface-container text-on-surface/60 border border-outline-variant/40 text-sm font-bold">
            Cancel
          </button>
          <div className="ml-auto flex gap-2 items-center">
            {confirmDelete ? (
              <>
                <span className="text-xs text-red-400">Delete &quot;{game.title}&quot;? This cannot be undone.</span>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-2 rounded-lg bg-surface-container text-on-surface/60 border border-outline-variant/40 text-sm font-bold"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="px-3 py-2 rounded-lg text-red-400 border border-red-500/30 text-sm font-bold hover:bg-red-500/10 transition-colors"
              >
                Delete game
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

export function ModalShell({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 sm:p-8" onClick={onClose}>
      <div
        className={`glass-panel rounded-2xl w-full my-auto p-6 shadow-2xl ${wide ? "max-w-5xl" : "max-w-3xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-h3 font-black tracking-tight text-on-surface">{title}</h3>
          <button onClick={onClose} className="text-on-surface/40 hover:text-on-surface material-symbols-outlined">close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
