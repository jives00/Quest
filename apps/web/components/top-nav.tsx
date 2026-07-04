"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api, type IgdbSearchResult } from "@/lib/api";

const topNavLinks = [
  { href: "/", label: "Dashboard" },
  { href: "/library", label: "Library" },
  { href: "/discover", label: "Discover" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/lists", label: "Lists" },
  { href: "/stats", label: "Stats" },
];

const avatarDropdownLinks = [
  { href: "/achievements", label: "Achievements" },
  { href: "/settings", label: "Settings" },
];

export function TopNav() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [searchResults, setSearchResults] = useState<IgdbSearchResult[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setShowDropdown(false);
      }
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setIsSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSearchInput(value: string) {
    setQuery(value);
    setHighlightedIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setSearchResults([]);
      setIsSearchOpen(false);
      return;
    }

    setIsSearchLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        if (!token) return;
        const results = await api.searchGames(value.trim(), token);
        setSearchResults(results.slice(0, 6));
        setIsSearchOpen(true);
      } catch (error) {
        console.error("Search error:", error);
        setSearchResults([]);
      } finally {
        setIsSearchLoading(false);
      }
    }, 300);
  }

  function handleSearchResultClick(result: IgdbSearchResult) {
    setIsSearchOpen(false);
    setQuery("");
    router.push(`/search?q=${encodeURIComponent(result.name)}`);
  }

  function handleSearchKeydown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isSearchOpen || searchResults.length === 0) {
      if (e.key === "Enter") {
        handleSubmit(e as unknown as React.FormEvent);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0) {
          handleSearchResultClick(searchResults[highlightedIndex]);
        } else {
          handleSubmit(e as unknown as React.FormEvent);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsSearchOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearchOpen(false);
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  async function handleLogout() {
    await logout();
    setShowDropdown(false);
    router.push("/login");
  }

  if (!token) return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 border-b border-outline-variant/40 bg-background/80 backdrop-blur-2xl">
      <div className="flex h-full items-center justify-between px-8 gap-8">
        {/* Left: Logo + Search Bar */}
        <div className="flex items-center gap-6 flex-1 min-w-0">
          <Link href="/" className="flex items-center gap-2 whitespace-nowrap">
            <Image src="/quest/quest-icon.png" alt="Quest" width={32} height={32} className="rounded-lg" />
            <span className="text-2xl font-black italic tracking-tighter text-on-surface uppercase">QUEST</span>
          </Link>
          <div className="flex-1 min-w-0 relative" ref={searchContainerRef}>
            <form onSubmit={handleSubmit} className="flex-1 min-w-0">
              <div className="relative">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  onKeyDown={handleSearchKeydown}
                  placeholder="Search games…"
                  className="w-full rounded-full border border-outline-variant/60 bg-surface-container-high px-4 py-2 pr-10 text-on-surface placeholder:text-on-surface/40 focus:border-accent focus:outline-none transition-colors text-sm"
                />
                {isSearchLoading && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-on-surface/20 border-t-on-surface rounded-full animate-spin" />
                )}
              </div>
            </form>

            {isSearchOpen && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-surface-container-low border border-outline-variant/40 rounded-lg shadow-xl z-50 overflow-hidden max-h-96 overflow-y-auto">
                {searchResults.map((result, index) => (
                  <button
                    key={result.igdbId}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-on-surface/5 text-left transition-colors ${
                      index === highlightedIndex ? "bg-on-surface/10" : ""
                    }`}
                    onMouseDown={() => handleSearchResultClick(result)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                  >
                    {result.coverUrl && (
                      <img
                        src={result.coverUrl}
                        className="w-8 h-12 object-cover shrink-0"
                        alt=""
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-on-surface truncate">
                        {result.name}
                      </p>
                      <p className="text-xs text-on-surface/50">
                        {result.year ?? "—"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Middle: Nav Links */}
        <nav className="hidden lg:flex items-center gap-8">
          {topNavLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-on-surface font-medium transition-colors hover:text-accent"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Right: User Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center justify-center w-10 h-10 rounded-full overflow-hidden border border-outline-variant/40 hover:border-outline-variant/80 transition-colors bg-surface-container"
          >
            <Image
              src="/quest/avatar.jpg"
              alt="User avatar"
              width={40}
              height={40}
              className="w-full h-full object-cover"
            />
          </button>
          {showDropdown && (
            <div className="absolute right-0 mt-2 w-48 bg-surface-container-low border border-outline-variant/40 rounded-xl overflow-hidden z-20 shadow-xl">
              {avatarDropdownLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setShowDropdown(false)}
                  className="block w-full text-left px-4 py-3 text-on-surface hover:bg-on-surface/10 transition-colors text-sm font-medium border-b border-outline-variant/30"
                >
                  {link.label}
                </Link>
              ))}
              <button
                onClick={handleLogout}
                className="block w-full text-left px-4 py-3 text-on-surface hover:bg-on-surface/10 transition-colors text-sm font-medium text-red-400 hover:text-red-300"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
