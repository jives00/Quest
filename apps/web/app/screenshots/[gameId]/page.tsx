"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type {
  GameScreenshots,
  Screenshot,
  ScreenshotExportResult,
  ScreenshotFlag,
  ScreenshotVariant,
  UiBox,
} from "@quest/types";
import { useAuth } from "@/lib/auth-context";
import { api, screenshotImageUrl } from "@/lib/api";

export const dynamic = "force-dynamic";

const POLL_MS = 10_000;

const FLAG_LABELS: Record<ScreenshotFlag, string> = {
  duplicate: "Duplicate",
  blurry: "Blurry",
  dark: "Dark",
};

const BTN =
  "px-4 py-2 rounded-full text-sm font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const BTN_NEUTRAL = `${BTN} bg-surface-container text-on-surface/80 border-outline-variant/60 hover:text-on-surface`;
const BTN_ACCENT = `${BTN} bg-accent text-on-primary border-accent`;

/** Which file a tile/lightbox shows: the cleaned copy when that's what exports. */
function shownVariant(s: Screenshot): ScreenshotVariant {
  return s.exportVariant === "cleaned" && s.hasCleaned ? "cleaned" : "original";
}

function thumbUrl(s: Screenshot): string {
  return shownVariant(s) === "cleaned"
    ? screenshotImageUrl(s.id, "clean-thumb", s.maskVersion)
    : screenshotImageUrl(s.id, "thumb");
}

interface DragRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  additive: boolean;
  base: Set<number>;
}

export default function ScreenshotReviewPage() {
  const router = useRouter();
  const params = useParams<{ gameId: string }>();
  const gameId = Number(params.gameId);
  const { token, isLoading } = useAuth();

  const [data, setData] = useState<GameScreenshots | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hideRejected, setHideRejected] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [exportName, setExportName] = useState("");
  const [confirmExport, setConfirmExport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ScreenshotExportResult | null>(null);
  const [drag, setDrag] = useState<DragRect | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  const load = useCallback(
    async (quiet = false) => {
      if (!token || !Number.isInteger(gameId)) return;
      if (!quiet) setLoading(true);
      try {
        const res = await api.getGameScreenshots(gameId, token);
        setData(res);
        if (!quiet) setExportName(res.exportName);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [token, gameId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Only shots still in review; exported ones live on the game page.
  const pending = useMemo(
    () => (data?.screenshots ?? []).filter((s) => s.staged && s.status !== "exported"),
    [data],
  );
  const visible = useMemo(
    () => (hideRejected ? pending.filter((s) => s.status !== "reject") : pending),
    [pending, hideRejected],
  );
  const keepCount = pending.filter((s) => s.status === "keep").length;
  const cleaningCount = pending.filter((s) => s.hasUi && s.inpaintStatus === "queued").length;
  const cleaning = cleaningCount > 0;

  // The agent paints UI out in the background; refresh while any is outstanding.
  useEffect(() => {
    if (!cleaning) return;
    const t = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(t);
  }, [cleaning, load]);

  // ── Mutations ────────────────────────────────────────────────────────────

  const patchLocal = useCallback((ids: number[], change: Partial<Screenshot>) => {
    const set = new Set(ids);
    setData((d) =>
      d ? { ...d, screenshots: d.screenshots.map((s) => (set.has(s.id) ? { ...s, ...change } : s)) } : d,
    );
  }, []);

  const applyStatus = useCallback(
    async (ids: number[], status: "keep" | "reject") => {
      if (!token || !ids.length) return;
      patchLocal(ids, { status, statusSource: "user" });
      try {
        await api.updateScreenshots(ids, { status }, token);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        void load(true);
      }
    },
    [token, patchLocal, load],
  );

  const applyVariant = useCallback(
    async (ids: number[], exportVariant: ScreenshotVariant) => {
      if (!token || !data) return;
      const eligible =
        exportVariant === "cleaned"
          ? ids.filter((id) => data.screenshots.find((s) => s.id === id)?.hasCleaned)
          : ids;
      if (!eligible.length) return;
      patchLocal(eligible, { exportVariant });
      try {
        await api.updateScreenshots(eligible, { exportVariant }, token);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        void load(true);
      }
    },
    [token, data, patchLocal, load],
  );

  const toggleVariant = useCallback(
    (ids: number[]) => {
      if (!data) return;
      const shots = data.screenshots.filter((s) => ids.includes(s.id) && s.hasCleaned);
      if (!shots.length) return;
      // Mixed selection flips to "cleaned" first; all-cleaned flips back.
      const allCleaned = shots.every((s) => s.exportVariant === "cleaned");
      void applyVariant(shots.map((s) => s.id), allCleaned ? "original" : "cleaned");
    },
    [data, applyVariant],
  );

  /** Put shots with UI back on the agent's queue, mask unchanged. */
  const retryRemoval = useCallback(
    async (ids: number[]) => {
      if (!token || !data) return;
      const eligible = ids.filter((id) => {
        const s = data.screenshots.find((x) => x.id === id);
        return s?.hasUi && s.staged && s.inpaintStatus !== "queued";
      });
      if (!eligible.length) return;
      patchLocal(eligible, { inpaintStatus: "queued", inpaintError: null });
      try {
        await api.requeueScreenshotInpaint(eligible, token);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        void load(true);
      }
    },
    [token, data, patchLocal, load],
  );

  // ── Selection ────────────────────────────────────────────────────────────

  const handleTileClick = (e: React.MouseEvent, s: Screenshot, index: number) => {
    if (e.shiftKey && anchor != null) {
      const from = visible.findIndex((v) => v.id === anchor);
      const [a, b] = from < index ? [from, index] : [index, from];
      const range = visible.slice(Math.max(0, a), b + 1).map((v) => v.id);
      setSelected((prev) => new Set([...(e.ctrlKey || e.metaKey ? prev : []), ...range]));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(s.id)) next.delete(s.id);
        else next.add(s.id);
        return next;
      });
    } else {
      setSelected(new Set([s.id]));
    }
    setAnchor(s.id);
  };

  const selectWhere = (pred: (s: Screenshot) => boolean) => {
    setSelected(new Set(visible.filter(pred).map((s) => s.id)));
    setAnchor(null);
  };

  // Rubber-band selection: starts on empty grid space, not on a tile.
  const onGridMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-tile]")) return;
    e.preventDefault();
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, additive, base: additive ? new Set(selected) : new Set() });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const next = { ...drag, x1: e.clientX, y1: e.clientY };
      setDrag(next);
      const left = Math.min(next.x0, next.x1);
      const right = Math.max(next.x0, next.x1);
      const top = Math.min(next.y0, next.y1);
      const bottom = Math.max(next.y0, next.y1);
      const hit = new Set(next.base);
      for (const [id, el] of tileRefs.current) {
        const r = el.getBoundingClientRect();
        if (r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom) hit.add(id);
      }
      setSelected(hit);
    };
    const up = () => setDrag(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag]);

  // ── Keyboard ─────────────────────────────────────────────────────────────

  // Look up in `pending`, not `visible`: rejecting the open shot while rejected
  // shots are hidden must not yank the lightbox closed.
  const lightboxShot = lightbox != null ? pending.find((s) => s.id === lightbox) ?? null : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      // In the lightbox, keys act on the shot being viewed.
      const ids = lightboxShot ? [lightboxShot.id] : [...selected];
      const key = e.key.toLowerCase();

      if ((e.ctrlKey || e.metaKey) && key === "a") {
        e.preventDefault();
        setSelected(new Set(visible.map((s) => s.id)));
        return;
      }
      if (key === "escape") {
        if (lightboxShot) setLightbox(null);
        else setSelected(new Set());
        return;
      }
      if (key === "k") void applyStatus(ids, "keep");
      else if (key === "x") void applyStatus(ids, "reject");
      else if (key === "c") toggleVariant(ids);
      else if (key === "arrowright" || key === "arrowleft") {
        e.preventDefault();
        const current = lightboxShot?.id ?? anchor ?? [...selected][0];
        const idx = visible.findIndex((s) => s.id === current);
        const nextIdx = key === "arrowright" ? Math.min(visible.length - 1, idx + 1) : Math.max(0, idx - 1);
        const next = visible[idx < 0 ? 0 : nextIdx];
        if (!next) return;
        if (lightboxShot) setLightbox(next.id);
        else {
          setSelected(new Set([next.id]));
          setAnchor(next.id);
          tileRefs.current.get(next.id)?.scrollIntoView({ block: "nearest" });
        }
      } else if (key === "enter" && !lightboxShot && selected.size === 1) {
        setLightbox([...selected][0]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, visible, anchor, lightboxShot, applyStatus, toggleVariant]);

  // ── Export ───────────────────────────────────────────────────────────────

  const saveExportName = async () => {
    if (!token || !data) return;
    const trimmed = exportName.trim();
    if (trimmed === data.exportName) return;
    try {
      await api.setScreenshotExportName(gameId, trimmed || null, token);
      const fresh = await api.getGameScreenshots(gameId, token);
      setData(fresh);
      setExportName(fresh.exportName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const runExport = async () => {
    if (!token) return;
    if (!confirmExport) {
      setConfirmExport(true);
      return;
    }
    setConfirmExport(false);
    setExporting(true);
    try {
      const res = await api.exportScreenshots(gameId, token);
      setExportResult(res);
      setSelected(new Set());
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  const preview =
    data?.nextNumber != null && keepCount > 0
      ? keepCount === 1
        ? `${data.exportName} (${data.nextNumber}).jpg`
        : `${data.exportName} (${data.nextNumber}).jpg … (${data.nextNumber + keepCount - 1}).jpg`
      : null;

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }
  if (!data) return <p className="p-10 text-red-400">{error ?? "Not found"}</p>;

  const selIds = [...selected];

  return (
    <div className="flex flex-col flex-1">
      <section className="bg-surface-container-lowest px-margin-page pt-[36px] pb-[24px]">
        <div className="max-w-page mx-auto flex flex-col gap-5">
          <div>
            <Link href="/screenshots" className="text-sm text-on-surface/50 hover:text-on-surface">
              ← Screenshots
            </Link>
            <h1 className="text-[44px] font-black leading-[1.05] tracking-[-0.04em] text-on-surface mt-1">
              <Link href={`/games/${gameId}`} className="hover:text-accent transition-colors">
                {data.title}
              </Link>
            </h1>
            <p className="text-[15px] text-on-surface/45 mt-1">
              {pending.length} in review · {keepCount} to keep · {pending.length - keepCount} rejected
              {cleaning && " · removing UI…"}
            </p>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-on-surface/60 mr-2 min-w-[90px]">
              {selected.size ? `${selected.size} selected` : "None selected"}
            </span>
            <button className={BTN_NEUTRAL} disabled={!selected.size} onClick={() => applyStatus(selIds, "keep")}>
              Keep <kbd className="opacity-50 ml-1">K</kbd>
            </button>
            <button className={BTN_NEUTRAL} disabled={!selected.size} onClick={() => applyStatus(selIds, "reject")}>
              Reject <kbd className="opacity-50 ml-1">X</kbd>
            </button>
            <button className={BTN_NEUTRAL} disabled={!selected.size} onClick={() => applyVariant(selIds, "cleaned")}>
              Use cleaned
            </button>
            <button className={BTN_NEUTRAL} disabled={!selected.size} onClick={() => applyVariant(selIds, "original")}>
              Use original
            </button>
            <button
              className={BTN_NEUTRAL}
              disabled={!pending.some((s) => selected.has(s.id) && s.hasUi && s.inpaintStatus !== "queued")}
              onClick={() => retryRemoval(selIds)}
              title="Send the selected shots back to the gaming PC to remove their UI again"
            >
              Retry UI removal
            </button>
            <div className="w-px h-6 bg-outline-variant/60 mx-2" />
            <span className="text-xs uppercase tracking-wider text-on-surface/40 mr-1">Select</span>
            <button className={BTN_NEUTRAL} onClick={() => selectWhere(() => true)}>All</button>
            <button className={BTN_NEUTRAL} onClick={() => selectWhere((s) => s.flags.length > 0)}>Flagged</button>
            <button className={BTN_NEUTRAL} onClick={() => selectWhere((s) => s.flags.includes("duplicate"))}>
              Duplicates
            </button>
            <button className={BTN_NEUTRAL} onClick={() => selectWhere((s) => s.hasCleaned)}>UI removed</button>
            <div className="w-px h-6 bg-outline-variant/60 mx-2" />
            <button
              className={hideRejected ? BTN_ACCENT : BTN_NEUTRAL}
              onClick={() => setHideRejected((v) => !v)}
            >
              Hide rejected
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="max-w-page mx-auto px-margin-page w-full pt-4">
          <p className="text-red-400 text-sm">
            {error}{" "}
            <button className="underline" onClick={() => setError(null)}>
              dismiss
            </button>
          </p>
        </div>
      )}

      {exportResult && (
        <div className="max-w-page mx-auto px-margin-page w-full pt-4">
          <div className="glass-panel rounded-xl p-4 text-sm text-on-surface/80">
            Exported {exportResult.exported} {exportResult.exported === 1 ? "file" : "files"}
            {exportResult.files.length > 0 && ` (${exportResult.files[0]}${exportResult.files.length > 1 ? ` … ${exportResult.files[exportResult.files.length - 1]}` : ""})`}
            , discarded {exportResult.purged}.
            {exportResult.folderWasEmpty && (
              <span className="block text-amber-300 mt-1">
                The wallpaper folder was empty before this export. If you expected existing wallpapers there,
                the NAS folder is probably not mounted correctly; check the path in docker-compose.yml.
              </span>
            )}
            {pending.length === 0 && (
              <Link href="/screenshots" className="block mt-2 text-accent">
                Back to the inbox →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Grid */}
      {/* Box-select can start anywhere in this area outside a tile, not just the thin grid gaps. */}
      <div className="max-w-page mx-auto px-margin-page pt-6 pb-[140px] w-full" onMouseDown={onGridMouseDown}>
        {pending.length === 0 ? (
          <p className="text-on-surface/50 py-16 text-center">Nothing left to review for this game.</p>
        ) : (
          <div
            ref={gridRef}
            className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 select-none p-2 -m-2"
          >
            {visible.map((s, index) => {
              const isSel = selected.has(s.id);
              const rejected = s.status === "reject";
              return (
                <div
                  key={s.id}
                  data-tile
                  ref={(el) => {
                    if (el) tileRefs.current.set(s.id, el);
                    else tileRefs.current.delete(s.id);
                  }}
                  onClick={(e) => handleTileClick(e, s, index)}
                  onDoubleClick={() => setLightbox(s.id)}
                  className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                    isSel ? "border-accent" : "border-transparent hover:border-outline-variant"
                  }`}
                  style={{ aspectRatio: `${s.width} / ${s.height}` }}
                >
                  <img
                    src={thumbUrl(s)}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className={`w-full h-full object-cover transition-opacity ${rejected ? "opacity-30" : ""}`}
                  />
                  <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
                    {s.flags.map((f) => (
                      <span key={f} className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/70 text-red-300">
                        {FLAG_LABELS[f]}
                      </span>
                    ))}
                    {s.hasCleaned && s.exportVariant === "cleaned" && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/70 text-accent-light">
                        UI removed
                      </span>
                    )}
                    {s.hasUi && s.inpaintStatus === "queued" && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/70 text-amber-300">
                        UI · cleaning
                      </span>
                    )}
                    {s.hasUi && s.inpaintStatus === "failed" && (
                      <span
                        title={s.inpaintError ?? undefined}
                        className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/70 text-amber-300"
                      >
                        Fill failed
                      </span>
                    )}
                  </div>
                  <div className="absolute bottom-1.5 right-1.5">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        rejected ? "bg-red-500/80 text-white" : "bg-black/60 text-on-surface/80"
                      }`}
                    >
                      {rejected ? "Reject" : "Keep"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-xs text-on-surface/35 mt-6">
          Click to select · Ctrl-click to toggle · Shift-click for a range · drag on empty space to box-select ·
          Ctrl-A all · Esc clear · double-click or Enter to open · ← → move · K keep · X reject · C original/cleaned
        </p>
      </div>

      {drag && (
        <div
          className="fixed border border-accent bg-accent/10 pointer-events-none z-40"
          style={{
            left: Math.min(drag.x0, drag.x1),
            top: Math.min(drag.y0, drag.y1),
            width: Math.abs(drag.x1 - drag.x0),
            height: Math.abs(drag.y1 - drag.y0),
          }}
        />
      )}

      {/* Export footer */}
      {pending.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-outline-variant/40 bg-background/90 backdrop-blur-2xl">
          <div className="max-w-page mx-auto px-margin-page py-4 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-on-surface/60">
              Export as
              <input
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                onBlur={saveExportName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="w-72 rounded-full border border-outline-variant/60 bg-surface-container-high px-4 py-2 text-on-surface focus:border-accent focus:outline-none text-sm"
              />
            </label>
            <span className="text-sm text-on-surface/50 flex-1 min-w-[200px]">
              {data.nextNumber == null
                ? "Wallpaper folder not reachable: check WALLPAPER_DIR"
                : preview
                  ? `${preview} · ${keepCount} ${keepCount === 1 ? "file" : "files"}`
                  : "No shots marked Keep"}
            </span>
            <button
              className={BTN_ACCENT}
              disabled={exporting || keepCount === 0 || data.nextNumber == null}
              title={cleaning ? `${cleaningCount} shot(s) still have UI waiting to be removed; they would export as originals` : undefined}
              onClick={runExport}
              onBlur={() => setConfirmExport(false)}
            >
              {exporting
                ? "Exporting…"
                : confirmExport
                  ? `Confirm: export ${keepCount} & discard ${pending.length - keepCount}${cleaning ? ` (${cleaningCount} not cleaned yet)` : ""}`
                  : `Export ${keepCount}`}
            </button>
          </div>
        </div>
      )}

      {lightboxShot && token && (
        <Lightbox
          shot={lightboxShot}
          token={token}
          onClose={() => setLightbox(null)}
          onKeep={() => applyStatus([lightboxShot.id], "keep")}
          onReject={() => applyStatus([lightboxShot.id], "reject")}
          onVariant={(v) => applyVariant([lightboxShot.id], v)}
          onBoxesSaved={() => load(true)}
          onRetry={() => retryRemoval([lightboxShot.id])}
          onError={setError}
        />
      )}
    </div>
  );
}

// ─── Lightbox ──────────────────────────────────────────────────────────────

function Lightbox({
  shot,
  token,
  onClose,
  onKeep,
  onReject,
  onVariant,
  onRetry,
  onBoxesSaved,
  onError,
}: {
  shot: Screenshot;
  token: string;
  onClose: () => void;
  onKeep: () => void;
  onReject: () => void;
  onVariant: (v: ScreenshotVariant) => void;
  onRetry: () => void;
  onBoxesSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [split, setSplit] = useState(50);
  const [showBoxes, setShowBoxes] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [manual, setManual] = useState<UiBox[]>(shot.manualBoxes);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setManual(shot.manualBoxes);
    setDrawing(false);
    setSplit(50);
  }, [shot.id, shot.manualBoxes]);

  const dirty = JSON.stringify(manual) !== JSON.stringify(shot.manualBoxes);
  const compare = shot.hasCleaned && !drawing;

  const toFrac = (e: React.MouseEvent) => {
    const r = frameRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const onFrameDown = (e: React.MouseEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const p = toFrac(e);
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onFrameMove = (e: React.MouseEvent) => {
    if (drawing && draft) {
      const p = toFrac(e);
      setDraft({ ...draft, x1: p.x, y1: p.y });
    } else if (compare && e.buttons === 1) {
      setSplit(toFrac(e).x * 100);
    }
  };
  const onFrameUp = () => {
    if (!draft) return;
    const box: UiBox = {
      x: Math.min(draft.x0, draft.x1),
      y: Math.min(draft.y0, draft.y1),
      w: Math.abs(draft.x1 - draft.x0),
      h: Math.abs(draft.y1 - draft.y0),
      kind: "manual",
    };
    setDraft(null);
    if (box.w > 0.005 && box.h > 0.005) setManual((m) => [...m, box]);
  };

  const saveBoxes = async () => {
    setSaving(true);
    try {
      await api.setScreenshotManualBoxes(shot.id, manual, token);
      setDrawing(false);
      onBoxesSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const boxes = [...shot.uiBoxes, ...manual];
  const original = screenshotImageUrl(shot.id, "full");
  const cleaned = screenshotImageUrl(shot.id, "clean", shot.maskVersion);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 text-sm">
        <span className="text-on-surface/60 mr-2">
          {new Date(shot.takenAt).toLocaleString()} · {shot.width}×{shot.height}
        </span>
        <button className={shot.status === "keep" ? BTN_ACCENT : BTN_NEUTRAL} onClick={onKeep}>Keep</button>
        <button className={shot.status === "reject" ? BTN_ACCENT : BTN_NEUTRAL} onClick={onReject}>Reject</button>
        {shot.hasCleaned && (
          <>
            <div className="w-px h-6 bg-outline-variant/60 mx-2" />
            <span className="text-on-surface/50">Export</span>
            <button className={shot.exportVariant === "original" ? BTN_ACCENT : BTN_NEUTRAL} onClick={() => onVariant("original")}>
              Original
            </button>
            <button className={shot.exportVariant === "cleaned" ? BTN_ACCENT : BTN_NEUTRAL} onClick={() => onVariant("cleaned")}>
              Cleaned
            </button>
          </>
        )}
        <div className="w-px h-6 bg-outline-variant/60 mx-2" />
        <button className={showBoxes ? BTN_ACCENT : BTN_NEUTRAL} onClick={() => setShowBoxes((v) => !v)}>
          Show UI mask
        </button>
        <button className={drawing ? BTN_ACCENT : BTN_NEUTRAL} onClick={() => setDrawing((v) => !v)}>
          {drawing ? "Drawing… drag over missed UI" : "Draw box"}
        </button>
        {manual.length > 0 && (
          <button className={BTN_NEUTRAL} onClick={() => setManual([])}>Clear drawn boxes</button>
        )}
        {/* Unsaved drawn boxes: the one action is to save them, which changes the
            mask and so re-queues removal on its own. A separate "retry" here would
            re-paint the old mask and silently ignore the new boxes. */}
        {dirty && (
          <button className={BTN_ACCENT} disabled={saving} onClick={saveBoxes}>
            {saving ? "Saving…" : "Remove UI incl. drawn boxes"}
          </button>
        )}
        {shot.hasUi && !dirty && (
          <>
            <div className="w-px h-6 bg-outline-variant/60 mx-2" />
            <span
              className={`max-w-[480px] truncate ${shot.inpaintStatus === "failed" ? "text-amber-300" : "text-on-surface/50"}`}
              title={shot.inpaintError ?? undefined}
            >
              {shot.inpaintStatus === "queued"
                ? "Removing UI… (waiting on the gaming PC)"
                : shot.inpaintStatus === "failed"
                  ? `UI removal failed${shot.inpaintError ? `: ${shot.inpaintError}` : ""}`
                  : shot.hasCleaned
                    ? "UI removed"
                    : "UI not removed yet"}
            </span>
            {shot.inpaintStatus !== "queued" && (
              <button className={BTN_NEUTRAL} onClick={onRetry}>
                {shot.hasCleaned ? "Re-clean" : "Remove UI"}
              </button>
            )}
          </>
        )}
        <a className={BTN_NEUTRAL} href={screenshotImageUrl(shot.id, "mask.png", shot.maskVersion)} download>
          Download mask
        </a>
        <button className={`${BTN_NEUTRAL} ml-auto`} onClick={onClose}>Close (Esc)</button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-6 pb-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div
          ref={frameRef}
          className={`relative ${drawing ? "cursor-crosshair" : compare ? "cursor-ew-resize" : ""}`}
          // Fit the frame itself to the viewport, so box overlays (in % of the
          // frame) line up with the image exactly.
          style={{
            aspectRatio: `${shot.width} / ${shot.height}`,
            width: `min(100%, calc((100vh - 110px) * ${shot.width / shot.height}))`,
          }}
          onMouseDown={(e) => {
            onFrameDown(e);
            if (compare && !drawing) setSplit(toFrac(e).x * 100);
          }}
          onMouseMove={onFrameMove}
          onMouseUp={onFrameUp}
        >
          <img src={original} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain select-none" />
          {compare && (
            <>
              <img
                src={cleaned}
                alt=""
                draggable={false}
                className="absolute inset-0 w-full h-full object-contain select-none"
                style={{ clipPath: `inset(0 0 0 ${split}%)` }}
              />
              <div className="absolute top-0 bottom-0 w-0.5 bg-white/80 pointer-events-none" style={{ left: `${split}%` }} />
              <span className="absolute top-2 left-2 text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-black/70 text-on-surface/80">Original</span>
              <span className="absolute top-2 right-2 text-[11px] font-bold uppercase px-2 py-0.5 rounded bg-black/70 text-accent-light">Cleaned</span>
            </>
          )}
          {showBoxes && (
            <img
              src={screenshotImageUrl(shot.id, "mask.png", shot.maskVersion)}
              alt=""
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none mix-blend-screen opacity-40"
            />
          )}
          {(showBoxes || drawing) &&
            boxes.map((b, i) => (
              <div
                key={i}
                className={`absolute border-2 pointer-events-none ${b.kind === "manual" ? "border-accent" : "border-amber-300"}`}
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
              />
            ))}
          {draft && (
            <div
              className="absolute border-2 border-accent bg-accent/20 pointer-events-none"
              style={{
                left: `${Math.min(draft.x0, draft.x1) * 100}%`,
                top: `${Math.min(draft.y0, draft.y1) * 100}%`,
                width: `${Math.abs(draft.x1 - draft.x0) * 100}%`,
                height: `${Math.abs(draft.y1 - draft.y0) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
