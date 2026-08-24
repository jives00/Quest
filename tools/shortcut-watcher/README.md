# Quest shortcut watcher

Reports **non-Steam games launched from Steam** ("Add a Non-Steam Game" shortcuts)
to Quest, so they get play sessions, playtime totals and a now-playing card like
any other game.

Runs on the Windows PC you actually play on — not on the NAS.

## Why this exists

Steam's Web API cannot see these games at all:

- `GetOwnedGames` never lists shortcuts, so the Steam poller finds no playtime.
- `GetPlayerSummaries` omits `gameid`/`gameextrainfo` while one is running, so the
  presence poller never sees a now-playing game — even though the Steam client
  itself plainly shows *"In non-Steam game"*.

Steam does track them, but only on the local disk, and it only flushes those files
**when the Steam client exits**:

| file | holds | keyed by |
| --- | --- | --- |
| `userdata/<id>/config/shortcuts.vdf` | appid, name, exe, `LastPlayTime` | — |
| `userdata/<id>/config/localconfig.vdf` | `Playtime` (cumulative minutes) | the appid as a **signed** int32 |

If you leave Steam running for weeks, those files stay stale for weeks. So this
agent times the game process itself instead, and reports real start/end times.

## Install

On the gaming PC, from this directory:

```powershell
.\install-task.ps1 -ApiBase http://100.115.171.80:3007 -ApiKey <SCROBBLE_API_KEY>
```

`SCROBBLE_API_KEY` is the value from the API's `.env`. The installer writes it to
`%LOCALAPPDATA%\Quest\shortcut-watcher\config.json` (locked to your user) and
registers a Scheduled Task that starts at logon and restarts on failure — the key
is deliberately **not** put in the task's command line, where anyone opening Task
Scheduler could read it.

No admin rights required.

To remove it:

```powershell
.\install-task.ps1 -Uninstall
```

## Check it works

```powershell
# What shortcuts does it see, and is one running right now?
.\shortcut-watcher.ps1 -DumpShortcuts

# Live log
Get-Content "$env:LOCALAPPDATA\Quest\shortcut-watcher\watcher.log" -Tail 20 -Wait

# One poll in the foreground, without installing anything
.\shortcut-watcher.ps1 -ApiBase http://100.115.171.80:3007 -ApiKey <key> -Once
```

## How it decides a game is "launched from Steam"

Two conditions, both required (disable with `-RequireSteamLaunch $false`):

1. `steam.exe` is running.
2. The shortcut's `LastPlayTime` is at or after the game process's start time.

Steam rewrites `shortcuts.vdf` at launch, stamping `LastPlayTime` for the shortcut
it just started — verified against a shortcut launched at 20:37:55, which produced
a file write at 20:37:56 while Steam went on running for another 50 minutes.
Launching the exe directly leaves the stamp untouched, so those sessions are
ignored, which is the intended scope.

## Behaviour worth knowing

- **Wall-clock, not Steam's counter.** A game left sitting at the menu counts.
  Steam counts it the same way, but the two numbers are derived independently and
  will drift slightly.
- **Only sees what happens while it runs.** Nothing is reconstructed after the
  fact. If the PC reboots and the task does not start, that session is lost.
- **Crash-safe within a session.** State is checkpointed every poll; a watcher
  killed mid-session reports up to the last poll it observed the game alive
  (`lastSeen`), never the gap while it was dead.
- **Retries are safe.** Every session carries a `clientUid`; the API dedupes on it
  at the database level, so a stop that is retried after a lost response is
  recorded once. Unsendable stops queue in `pending.json` and drain when the API
  returns.
- **Sessions under 2 minutes are dropped**, and anything over 12 hours is rejected
  as implausible (both enforced server-side).

## Files it writes

All under `%LOCALAPPDATA%\Quest\shortcut-watcher\`:

| file | purpose |
| --- | --- |
| `config.json` | API base + key (user-only ACL) |
| `state.json` | the in-progress session, checkpointed each poll |
| `pending.json` | stops not yet accepted by the API |
| `watcher.log` | activity log, trimmed at 2 MB |

## API surface

Both authenticate with `X-Api-Key: $SCROBBLE_API_KEY`.

```
POST /api/ingest/steam-shortcut/heartbeat
     { appId, name }
     -> refreshes now-playing (goes stale after 5 min on its own)

POST /api/ingest/steam-shortcut/stop
     { appId, name, startedAt, endedAt, clientUid }
     -> records the session; idempotent on clientUid
```

Games resolve through the normal matching pipeline under the `steam_nonsteam`
external-id source, and are attributed to the `steam` platform.
