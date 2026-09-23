"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScreenshotInboxItem } from "@quest/types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export default function ScreenshotInboxPage() {
  const router = useRouter();
  const { token, isLoading } = useAuth();
  const [items, setItems] = useState<ScreenshotInboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api
      .getScreenshotInbox(token)
      .then((res) => setItems(res.items))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [token]);

  const totalShots = items.reduce((n, i) => n + i.total, 0);

  return (
    <div className="flex flex-col flex-1">
      <section className="bg-surface-container-lowest px-margin-page pt-[44px] pb-[36px]">
        <div className="max-w-page mx-auto">
          <h1 className="text-[52px] font-black leading-[1.05] tracking-[-0.04em] text-on-surface mb-2">
            Screenshots
          </h1>
          <p className="text-[17px] text-on-surface/45">
            {items.length === 0
              ? "Nothing waiting for review"
              : `${totalShots} shots across ${items.length} ${items.length === 1 ? "game" : "games"} waiting for review`}
          </p>
        </div>
      </section>

      <div className="max-w-page mx-auto px-margin-page pt-[40px] pb-[64px] w-full">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <p className="text-red-400">{error}</p>
        ) : items.length === 0 ? (
          <div className="glass-panel rounded-xl p-10 text-center text-on-surface/50">
            New Steam screenshots show up here automatically once the screenshot-sync agent on your gaming PC
            uploads them.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {items.map((item) => (
              <Link
                key={item.gameId}
                href={`/screenshots/${item.gameId}`}
                className="glass-panel rounded-xl p-4 flex gap-4 green-glow-hover transition-all"
              >
                {item.coverPath ? (
                  <img src={item.coverPath} alt="" className="w-20 h-[106px] object-cover rounded-md shrink-0" />
                ) : (
                  <div className="w-20 h-[106px] rounded-md bg-surface-container shrink-0" />
                )}
                <div className="min-w-0 flex flex-col gap-2">
                  <p className="text-lg font-bold text-on-surface truncate">{item.title}</p>
                  <p className="text-sm text-on-surface/60">
                    {item.total} shots · {item.keep} to keep
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.autoRejected > 0 && (
                      <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-red-500/15 text-red-300">
                        {item.autoRejected} auto-rejected
                      </span>
                    )}
                    {item.cleaned > 0 && (
                      <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-accent/20 text-accent-light">
                        {item.cleaned} UI removed
                      </span>
                    )}
                    {item.inpaintPending > 0 && (
                      <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">
                        {item.inpaintPending} cleaning…
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
