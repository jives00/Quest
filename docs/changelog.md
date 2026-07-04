# Changelog

## July 4, 2026

### Frontend – Web
- Hero and now-playing images switched from plain `<img>` to `next/image` (with `priority`) so they're resized/re-encoded and prioritized for above-the-fold load instead of transferring full-resolution IGDB/SteamGridDB source images `2512dca`
- Now Playing hero: match the standard hero's image treatment (right 4/5 width, unblurred, left-to-right fade) instead of a fully blurred/darkened background `7afabc5`
- Game detail: "Rarity" achievement sort now ranks locked achievements by rarity too, instead of only sorting unlocked ones and dumping every locked achievement into an unsorted bottom bucket `5502f97`
- New `/achievements` page: infinite-scroll list of every achievement across the library with Rarity/Date/Name/Locked sorts (default Date) and a per-game filter; linked from Stats' "Rarest Achievements" section and the avatar dropdown menu `f6b2422`
- New `/history` page: infinite-scroll feed of every tracked event (play sessions, achievements, completions, status changes, wishlist/backlog adds, ownership) with game and event-type filters, newest first; linked from Stats' "Recent Activity" section, the avatar dropdown menu, and a "View History" link on the game detail sidebar (pre-filtered to that game) `7a78f7f`

### Backend
- Stats: `getStats`/`getYearStats` now run their independent queries concurrently via `Promise.all` instead of ~20-25 sequential round trips per dashboard/year-in-review load `1ee3bcf`
- MySQL pool: explicit `connectionLimit`/`waitForConnections` instead of implicit mysql2 defaults, shared across web requests and the Steam/PSN/Xbox pollers `1ee3bcf`
- New `/api/achievements` and `/api/achievements/games` endpoints: paginated cross-game achievement listing with sort/game filters, deduped by preferred source (Steam over PSN) so dual-platform games don't double-count `f6b2422`
- New `/api/activity` endpoint: paginated version of the recent-activity feed with type/game filters, built on a shared UNION query extracted from `getRecentActivity` `7a78f7f`

## July 1, 2026

### Frontend – Web
- Session middleware checks `quest_refreshToken` cookie instead of generic `refreshToken` `d196e0d`

### Backend
- Fix refresh-token cookie collision with Trakt: both apps share the `synology` Tailscale hostname (differ only by port), and cookies are scoped by hostname+path not port, so the shared `refreshToken` cookie name caused each app's login to silently overwrite the other's session cookie, producing spurious "Invalid or expired refresh token" logouts; renamed to `quest_refreshToken` `d196e0d`

## June 30, 2026

### Frontend – Web
- Fix premature logout: `request()` now retries once on 401 via a deduped, refresh-and-retry interceptor instead of failing permanently after the 15-minute access token expires `0572dde`
- Remove the "refresh once" guard; add a proactive 10-minute refresh timer in `auth-context.tsx` so the access token renews before it expires `0572dde`

### Frontend – Mobile
- Fix premature logout: same 401 retry interceptor and proactive 10-minute refresh timer as web `0572dde`
- Add `AppState` foreground listener so the access token refreshes when the app resumes from background, debounced to avoid redundant calls `0572dde`
- Adaptive icon art updated `0572dde`

## June 28, 2026

### Frontend – Web
- Library: platform dropdown shows name only for custom platforms (was prepending image URL); game count bumped to text-base `ec83094`
- Settings › Imports: same URL-in-label fix for custom platform dropdown `ec83094`
- Game detail: completion date picker now auto-saves on date select — no Confirm button needed; fixes native date popup closing dropdown before save `893b5a9`
- Settings › Platforms: unified editable list for built-in and custom platforms; built-ins renameable with icon override; custom platforms support inline name/icon editing and delete `ba980ba`
- Icon picker: URL input popover with live image preview; `PlatformIcon` component renders URL as `<img>` or emoji as text `ba980ba`
- Library: platform filter is a flat alpha-sorted list including custom platforms `ba980ba`
- Settings › Imports: platform dropdown unified with library filter (same sorted list) `ba980ba`
- Game detail: ownership buttons use icon overrides for built-in platforms and icon-only display for custom platforms `ba980ba`

### Backend
- Home: fixed hero banner double-image flash caused by React Strict Mode double-invoking the hero fetch; seed is now generated once per page mount and passed to the API so repeated calls return the same game `add56f1`
- Game detail: achievements section — Group DLC toggle, per-group progress bar and counter, larger/white group headers, improved locked achievement contrast, bg-surface-container rows `a6a5d1d`
- Game detail: sidebar — ownership moved above links, notes section removed, list name font size increased `a6a5d1d`
- Game detail: Media section between description and achievements with 16:9 main viewer, looping chevron navigation, and thumbnail strip (trailer + screenshots); clicking a thumbnail swaps the main display `8b5fa77`
- Edit modal: new Media tab to set/preview YouTube trailer and add/remove IGDB screenshots by URL or image ID `8b5fa77`
- Discover: removed By Genre tab and all associated genre state/UI `c4fc3e2`
- Stats: heatmap tooltip replaced with styled card showing spelled-out date and time played `97fbe08`
- Stats: heatmap date cells and month labels now use local date instead of UTC to fix timezone off-by-one `97fbe08`
- Stats: activity feed game title bumped to text-base `97fbe08`
- Stats: Ownership by Platform legend replaced with custom 2-column grid; pie tooltip uses shared ChartTooltip style `97fbe08`

### Frontend – Mobile
- App icon updated: 1024×1024, transparent background with added padding `3ed2486`
- Library: filter chips no longer shift position or stretch on initial load — constrained height from first render `1e7f3b4`
- Game detail: removed Notes section `1e7f3b4`
- Game detail: rating buttons now fit on a single row using flex layout `1e7f3b4`
- Game detail: Owned On now shows display names (e.g. "PlayStation" not "psn") matching Settings labels `1e7f3b4`

### Backend
- Custom platforms (`user_platforms`) fully wired: ownership on game detail, library filter, imports dropdown, stats breakdown `ba980ba`
- New `custom_ownership` routes: POST/DELETE `/api/custom-ownership`; library base query includes games only in `custom_ownership` `ba980ba`
- Added `backfill-media` script to fill missing YouTube trailer IDs and IGDB screenshot IDs via `enrichGame()` `3ed2486`
- New `platform-overrides` routes: GET/PUT/DELETE `/api/platform-overrides/:platform` for per-user built-in platform name+icon overrides `ba980ba`
- Fix: PATCH `/api/user-platforms/:id` null-trim crash when `icon` sent as `null` `ba980ba`
- Migrations 032–035: `icon` column on `user_platforms`, `user_platform_overrides` table, widen icon to TEXT `ba980ba`
- Dashboard hero endpoint: uses client-supplied `?seed` for `RAND(seed)` instead of unseeded `RAND()`, making the selection stable within a page load while varying per reload `add56f1`
- Dashboard summary: `finishedCount` now includes games with `other` status in addition to `completed` `341f24c`
- Game enrichment: fetch and store YouTube trailer video IDs and IGDB screenshot image IDs from IGDB on each enrich run; `GameMetadataPatch` exposes both for manual editing `8b5fa77`
- Migration 031: `trailer_video_ids` and `screenshot_image_ids` JSON columns on `games` table `8b5fa77`
- Stats: heatmap query uses client-supplied timezone offset (`?tz=` minutes) to bucket sessions by local date `97fbe08`

## June 27, 2026

### Frontend – Web
- Settings › Imports: replaced three separate per-platform cards with a single panel with a platform dropdown; widened to all six platforms (Steam, PSN, Xbox, Epic, GOG, Meta Quest) `2fb1c59`
- Navbar: replaced joystick material icon with Quest app icon image `e083006`
- Favicon: added Quest icon as web favicon via Next.js `app/icon.png` `e083006`
- Wishlist: sort pills (A–Z, Release, Rating, Price); custom card grid showing title, release date, MC score, and current/low price on one line `47a17ef`
- Wishlist: render games immediately with price placeholders and stream in ITAD prices per-card as they resolve, instead of blocking the whole page on all price lookups `a05515f`
- Game detail: achievements now group into per-DLC sections (Base Game + expansion/DLC groups) `2e9f25d`

### Frontend – Mobile
- Game detail: achievements now grouped by DLC into collapsible Base Game + DLC sections (per-group earned/total), each row showing icon, description, and unlock state / rarity % — matches web `a8e5d6b`
- App icon and adaptive icon replaced with Quest icon `e083006`
- Dashboard: removed hero image, "Your Library" stats, and Recent Sessions; reordered to Currently Playing → Backlog → Last 14 Days; activity graph now always shows all 14 days (fills blanks with zero bars) `0ed59de`
- Library: merged Status and Platform filter rows into a single scrollable chip row with a divider; fixed chip text clipping on Android (added paddingVertical to contentContainerStyle) `0ed59de`; increased ScrollView height 50→56 and dropped paddingVertical so bottom borders aren't clipped `0b8a89f`
- Discover: fixed filter chip text clipping on Android `0ed59de`
- Stats: replaced 8-card overview + separate By Status section with a 2×2 grid (Lifetime · Achievements · Backlog · Completed) matching the web layout; added `formatHours` compact formatter to prevent overflow on the Lifetime card `0ed59de`
- Wishlist: promoted to bottom nav tab (swapped with Discover); fixed price display (ITAD returns dollars, was dividing by 100); added release date; differentiated "Not currently listed" from "No price data"; added historical low price display without requiring a current deal; show "TBD" when release date is unknown `0ed59de` `fbad340`; sort chips (A–Z, Release, Rating, Price); MC score on each row; price condensed to one line (current | historical low) `47a17ef`
- Wishlist: render games immediately with price placeholders and stream in ITAD prices per-row as they resolve, instead of blocking the whole screen on all price lookups `a05515f`
- Lists: hide platform lists; remove systemKey subtitle from system list rows `fbad340`
- Navigation: Wishlist is now a top-level tab; Discover moved to the More menu `0ed59de`

### Backend
- Achievements: group by DLC via TrueSteamAchievements (server-side scrape, `tsa.client`) — replaces the Cloudflare-gated SteamDB endpoint; matches achievements by display name and sets `dlc_app_name` on enrich; uses `node:https` since undici/fetch is 403'd `2e9f25d`
- Tooling: add `backfill-dlc-groups` script (library-wide DLC grouping via TrueSteamAchievements); drop dead SteamDB code from `backfill-achievements` `58be414`
- Ownership: removed platforms no longer re-added by pollers — `DELETE /ownership` now writes a suppression row; `POST /ownership` clears it `d1d4f11`
- Migration 030: `ownership_suppressions` table `d1d4f11`
- VR detection: add `"Oculus VR"` (IGDB platform 162), `"Meta Quest"`, and `"Meta Quest Pro"` to VR platform name set — Meta Quest games were not being flagged `32b9073`
- Migration 028: backfill `vr_supported = 1` for existing games with Oculus VR / Meta Quest platform names missed by the original backfill `32b9073`
- Migration 029: fix VR system list always showing empty — `system_key` ENUM was missing `'vr'` `9f410a9`
- Lists: add `metacritic` to all `getListGames` query paths and `ListGameRow` interface `47a17ef`
- API: reduce Fastify logger to `warn` level — silences per-request INFO noise `fbad340`
- API: add diagnostic logging to ITAD price path (disabled key, missing steamAppId, lookup failures, overview failures) `fbad340`
- API: add entry-level log to `getWishlistPrice` to confirm whether function is called on NAS `0b8a89f`; removed once resolved `2c45b83`
- docker-compose: add `ITAD_API_KEY` and `OPENXBL_API_KEY` to container env block — these were in `.env` but never passed through, causing pricing to silently fail on NAS `fbad340`
- Imports: widen `POST /imports/:source` to accept all platforms (was epic/gog/meta_quest only) `2fb1c59`
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
