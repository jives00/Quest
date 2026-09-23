"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { GameScreenshots, Screenshot } from "@quest/types";
import { api, screenshotImageUrl } from "@/lib/api";

/** In review and not rejected: shown with an "In review" tag until exported. */
function isInReview(s: Screenshot): boolean {
  return s.staged && s.status === "keep";
}

/** The version that will be (or was) exported: the cleaned copy when chosen. */
function showsCleaned(s: Screenshot): boolean {
  return isInReview(s) && s.exportVariant === "cleaned" && s.hasCleaned;
}

/**
 * "Your screenshots" on the game page: exported shots plus the ones still in
 * review (rejected ones left out), with a link into review while any are
 * undecided. Renders nothing for a game with no screenshots at all.
 */
export function GameScreenshotsStrip({ gameId, token }: { gameId: number; token: string }) {
  const [data, setData] = useState<GameScreenshots | null>(null);
  const [open, setOpen] = useState<Screenshot | null>(null);

  useEffect(() => {
    api
      .getGameScreenshots(gameId, token)
      .then(setData)
      .catch(() => setData(null));
  }, [gameId, token]);

  if (!data) return null;
  // In review first (newest work), then the exported set.
  const shown = [
    ...data.screenshots.filter(isInReview),
    ...data.screenshots.filter((s) => s.status === "exported"),
  ];
  const unreviewed = data.screenshots.filter((s) => s.staged && s.status !== "exported" && s.statusSource === "auto").length;
  const readyToExport = data.screenshots.filter(isInReview).length;
  if (!shown.length && !unreviewed) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <span className="block w-8 h-1 bg-accent rounded mb-2" />
          <h2 className="text-h2 font-black tracking-tight text-on-surface">Your screenshots</h2>
        </div>
        {unreviewed > 0 ? (
          <Link href={`/screenshots/${gameId}`} className="text-sm font-semibold text-accent hover:underline">
            {unreviewed} waiting for review →
          </Link>
        ) : readyToExport > 0 ? (
          <Link href={`/screenshots/${gameId}`} className="text-sm font-semibold text-accent hover:underline">
            {readyToExport} ready to export →
          </Link>
        ) : null}
      </div>
      {shown.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
          {shown.map((s) => (
            <button
              key={s.id}
              onClick={() => setOpen(s)}
              title={s.exportedName ?? (isInReview(s) ? "In review, not exported yet" : undefined)}
              className="relative flex-none overflow-hidden border-2 border-transparent hover:border-outline-variant transition-all"
            >
              <img
                src={
                  showsCleaned(s)
                    ? screenshotImageUrl(s.id, "clean-thumb", s.maskVersion)
                    : screenshotImageUrl(s.id, "thumb")
                }
                alt=""
                loading="lazy"
                className="h-24 w-auto object-cover"
              />
              {isInReview(s) && (
                <span className="absolute bottom-1 left-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/70 text-amber-300">
                  In review
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setOpen(null)}
        >
          <img
            src={
              showsCleaned(open)
                ? screenshotImageUrl(open.id, "clean", open.maskVersion)
                : screenshotImageUrl(open.id, "full")
            }
            alt=""
            className="max-w-full max-h-full object-contain"
          />
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-on-surface/70 bg-black/60 px-3 py-1 rounded">
            {open.exportedName ?? "In review, not exported yet"}
          </span>
        </div>
      )}
    </section>
  );
}
