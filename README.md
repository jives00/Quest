# Quest

A personal game tracker — think Trakt, but for games. Pulls playtime and achievements from Steam, PSN, and Xbox automatically; supports one-shot library imports for Epic, GOG, and Meta Quest; and provides a web dashboard and Android app to browse your library, track stats, and manage wishlists and backlogs.

Single-user, self-hosted on a Synology NAS. Not designed for public deployment, but the code is open.

---

## Features

- **Automatic sync** — Steam, PSN, and Xbox libraries and playtime polled in the background
- **One-shot imports** — Epic Games, GOG, and Meta Quest via file import in Settings
- **Game metadata** — covers, descriptions, genres, and release dates via IGDB (with RAWG fallback); artwork via SteamGridDB
- **Play sessions** — tracked automatically from sync deltas, with manual entry support
- **Achievements** — Steam and PSN trophy sync with rarity data
- **HLTB integration** — How Long to Beat estimates on game detail pages
- **Wishlist pricing** — live price lookups via IsThereAnyDeal (optional)
- **Stats** — lifetime playtime, by-platform breakdowns, completions by year, rarest achievements, activity heatmap
- **Lists** — system lists (backlog, wishlist, replay) and custom lists
- **Discover** — trending, new releases, anticipated, top-rated, and Steam top sellers via IGDB
- **Android app** — Expo/React Native with in-app update banner (auto-installs APK releases)

---

## Stack

| Layer | Tech |
|---|---|
| API | Fastify (Node 24, CommonJS) |
| Web | Next.js 14 (App Router) |
| Mobile | Expo SDK 54 / React Native 0.81 |
| Database | MySQL 8 (shared NAS container) |
| Monorepo | pnpm workspaces |
| CI/CD | GitHub Actions → GHCR → Watchtower |

---

## Repo layout

```
apps/
  api/          Fastify REST API (port 3007)
  web/          Next.js web frontend (port 3006)
  mobile/       Expo Android app
packages/
  types/        Shared TypeScript types (@quest/types)
apps/api/
  migrations/   Raw .sql migration files (applied manually)
  src/routes/   One file per resource group
  src/services/ Business logic + external API clients
```

---

## Getting started

### Prerequisites

- Node 24+
- pnpm 9+
- MySQL 8 database (create a `quest` database and a user with full grants on it)

### 1. Clone and install

```bash
git clone https://github.com/jives00/Quest.git
cd Quest
pnpm install
```

### 2. Configure environment

```bash
cp .env.example apps/api/.env
# Edit apps/api/.env and fill in the required values
```

Required variables:

| Variable | Description |
|---|---|
| `JWT_SECRET` | Long random string for signing JWTs |
| `ADMIN_USERNAME` | Initial admin username |
| `ADMIN_PASSWORD` | Initial admin password |
| `DB_HOST` | MySQL host |
| `DB_NAME` | MySQL database name |
| `DB_USER` / `DB_PASSWORD` | MySQL credentials |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | Twitch dev app ([dev.twitch.tv](https://dev.twitch.tv/console/apps)) |

Optional variables (features degrade gracefully without them):

| Variable | Description |
|---|---|
| `RAWG_API_KEY` | RAWG fallback metadata ([rawg.io](https://rawg.io/apidocs)) |
| `STEAMGRIDDB_KEY` | Better cover/hero art |
| `ITAD_API_KEY` | Wishlist pricing via IsThereAnyDeal |
| `STEAM_API_KEY` / `STEAM_ID64` | Steam sync |
| `PSN_NPSSO` | PSN sync (NPSSO token, ~2-month lifetime) |
| `OPENXBL_API_KEY` | Xbox/Game Pass sync via [xbl.io](https://xbl.io) |

### 3. Run migrations

```bash
pnpm --filter api migrate
```

Migrations are raw `.sql` files applied in order. The API does **not** auto-migrate on startup.

### 4. Start

```bash
# All apps in parallel
pnpm dev

# API only
pnpm --filter api dev
```

Web runs at `http://localhost:3006`, API at `http://localhost:3007`.

---

## Database migrations

Migration files live in `apps/api/migrations/` as numbered `.sql` files. Run them manually:

```bash
pnpm --filter api migrate
```

The runner applies any files not yet recorded in the `migrations` table. Never modify an already-applied file — add a new one instead.

---

## Deployment

This project deploys to a Synology NAS via Docker. The CI pipeline builds images on every merge to `main` and pushes them to GHCR; Watchtower picks up the new images within ~5 minutes.

```
git push origin main   # triggers build + deploy
```

### Mobile APK

Tagging a release builds and attaches an APK via GitHub Actions. The app has a built-in update banner that auto-installs new releases.

```bash
git tag apk-v1.2.3 && git push origin apk-v1.2.3
```

---

## License

[Creative Commons Attribution-NonCommercial 4.0](docs/LICENSE.md) — free to use and adapt for non-commercial purposes with attribution.
