# Changelog

## June 27, 2026

### Frontend – Mobile (2)
- Library / Discover: fix filter chip vertical clipping on Android — horizontal ScrollView now has explicit height so chips are no longer cut off `fbad340`
- Lists: hide platform lists; remove systemKey subtitle from system list rows `fbad340`
- Wishlist: show "TBD" when release date is unknown `fbad340`

### Backend (2)
- API: reduce Fastify logger to `warn` level — silences per-request INFO noise `fbad340`
- API: add diagnostic logging to ITAD price path (disabled key, missing steamAppId, lookup failures, overview failures) `fbad340`
- docker-compose: add `ITAD_API_KEY` and `OPENXBL_API_KEY` to container env block — these were in `.env` but never passed through, causing pricing to silently fail on NAS `fbad340`

### Frontend – Mobile
- Dashboard: removed hero image, "Your Library" stats, and Recent Sessions; reordered to Currently Playing → Backlog → Last 14 Days; activity graph now always shows all 14 days (fills blanks with zero bars) `0ed59de`
- Library: merged Status and Platform filter rows into a single scrollable chip row with a divider; fixed chip text clipping on Android (added paddingVertical to contentContainerStyle) `0ed59de`
- Discover: fixed filter chip text clipping on Android `0ed59de`
- Stats: replaced 8-card overview + separate By Status section with a 2×2 grid (Lifetime · Achievements · Backlog · Completed) matching the web layout; added `formatHours` compact formatter to prevent overflow on the Lifetime card `0ed59de`
- Wishlist: promoted to bottom nav tab (swapped with Discover); fixed price display (ITAD returns dollars, was dividing by 100); added release date; differentiated "Not currently listed" from "No price data"; added historical low price display without requiring a current deal `0ed59de`
- Navigation: Wishlist is now a top-level tab; Discover moved to the More menu `0ed59de`

### Backend
- Added `README.md` with setup instructions, environment variable reference, and deployment guide `0ed59de`
- Added `docs/changelog.md` `0ed59de`

---

## June 27, 2026 — Initial release `7879968`

### Backend
- Fastify REST API (CommonJS, Node 24) with JWT auth and single-user session management
- MySQL schema with migrations runner (`pnpm --filter api migrate`)
- Steam sync: library, playtime deltas, and achievements via Steam Web API; background poller
- PSN sync: library and trophy sync via NPSSO token; background poller
- Xbox/Game Pass sync via OpenXBL; background poller
- One-shot library imports for Epic Games, GOG, and Meta Quest (JSON/CSV upload in Settings)
- Game metadata matching via IGDB (primary) with RAWG fallback; SteamGridDB for cover/hero art
- HLTB (HowLongToBeat) playtime estimates
- ITAD (IsThereAnyDeal) wishlist price lookups (optional, key-gated)
- Play session tracking derived from sync deltas with manual entry support
- Achievement sync with rarity data (Steam globalPct, PSN trophy rarity)
- Lists API: system lists (backlog, wishlist, replay, VR), platform lists, custom lists
- Discover endpoint: trending, new releases, anticipated, top rated, Steam top sellers, by genre (IGDB)
- Stats API: lifetime overview, by-platform, by-genre, top played, completions by year, activity heatmap, rarest achievements
- Dashboard API: now playing (live session), daily play stats, currently playing, backlog
- Export endpoint for full library data
- App version endpoint for mobile update banner

### Frontend – Web
- Next.js 14 App Router; dark theme with accent color system
- Library grid with status and platform filters, search
- Game detail pages: metadata, play sessions, achievements, completions, notes, ratings
- Stats page: lifetime dashboard with activity feed, charts (bar, pie, heatmap), platform/genre breakdowns; Year in Review mode
- Discover page: category tabs + genre filter, infinite scroll grid
- Wishlist, Backlog, and custom list pages
- Search page
- Settings: platform account management, sync controls, library imports

### Frontend – Mobile
- Expo SDK 54 / React Native 0.81 Android app
- Dashboard screen: now playing (live indicator), currently playing carousel, backlog carousel, 14-day activity graph
- Library screen: full cover grid with status/platform filters and search
- Discover screen: category chip tabs, genre sub-filter, infinite scroll
- Wishlist screen: list view with ITAD pricing and release dates
- Lists screen with list detail
- Stats screen: overview cards, top played, by platform, by genre, completions by year, perfect games, rarest achievements
- Game detail screen
- In-app update banner (polls GitHub Releases, auto-installs APK)
- JWT auth with token refresh
