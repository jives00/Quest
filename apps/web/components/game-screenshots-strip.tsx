"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { GameScreenshots, Screenshot } from "@quest/types";
import { api, screenshotImageUrl } from "@/lib/api";

/**
 * "Your screenshots" on the game page: the shots exported to the wallpaper
 * folder, plus a link into review when new ones are waiting. Renders nothing
 * for a game with no screenshots at all.
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
  const exported = data.screenshots.filter((s) => s.status === "exported");
  const pending = data.screenshots.filter((s) => s.staged && s.status !== "exported").length;
  if (!exported.length && !pending) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between">
        <div>
          <span className="block w-8 h-1 bg-accent rounded mb-2" />
          <h2 className="text-h2 font-black tracking-tight text-on-surface">Your screenshots</h2>
        </div>
        {pending > 0 && (
          <Link href={`/screenshots/${gameId}`} className="text-sm font-semibold text-accent hover:underline">
            {pending} waiting for review →
          </Link>
        )}
      </div>
      {exported.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
          {exported.map((s) => (
            <button
              key={s.id}
              onClick={() => setOpen(s)}
              title={s.exportedName ?? undefined}
              className="flex-none overflow-hidden border-2 border-transparent hover:border-outline-variant transition-all"
            >
              <img src={screenshotImageUrl(s.id, "thumb")} alt="" loading="lazy" className="h-24 w-auto object-cover" />
            </button>
          ))}
        </div>
      )}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setOpen(null)}
        >
          <img src={screenshotImageUrl(open.id, "full")} alt="" className="max-w-full max-h-full object-contain" />
          {open.exportedName && (
            <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-on-surface/70 bg-black/60 px-3 py-1 rounded">
              {open.exportedName}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
