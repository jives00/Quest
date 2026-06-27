"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, type LibraryGame } from "@/lib/api";
import { CoverGrid } from "@/components/cover-grid";

export const dynamic = "force-dynamic";

export default function WishlistPage() {
  const router = useRouter();
  const { token, isLoading } = useAuth();
  const [games, setGames] = useState<LibraryGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoading && !token) router.push("/login");
  }, [token, isLoading, router]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api.getLists(token)
      .then((lists) => {
        const wishlist = lists.find((l) => l.systemKey === "wishlist");
        if (!wishlist) return setLoading(false);
        return api.getListDetail(wishlist.id, token).then((detail) => {
          setGames(detail.games);
        });
      })
      .catch((err) => console.error("Wishlist load error:", err))
      .finally(() => setLoading(false));
  }, [token]);

  if (isLoading) return null;
  if (!token) return null;

  return (
    <div className="flex flex-col flex-1">
      <section className="bg-surface-container-lowest px-margin-page py-10">
        <div className="max-w-page mx-auto">
          <h1 className="text-h1 font-black tracking-tight text-on-surface mb-2">Wishlist</h1>
          <p className="text-on-surface/40 text-sm">{games.length} games · synced from Steam</p>
        </div>
      </section>

      <div className="max-w-page mx-auto px-margin-page py-stack-lg w-full">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        ) : (
          <CoverGrid
            games={games}
            emptyMessage="Your wishlist is empty."
            navLabel="Wishlist"
            showReleaseDate
            gridClass="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
          />
        )}
      </div>
    </div>
  );
}
