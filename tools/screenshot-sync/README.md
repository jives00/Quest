# Quest screenshot sync

Uploads new **Steam screenshots** to Quest. On the gaming PC's GPU it also finds
UI (subtitles, "Skip" prompts, HUD) and paints it out. You then review each game's
shots in Quest (**Screenshots** in the top nav) and export the keepers to
`\\Synology\Wallpapers\Video Games` as `Game Title (N).jpg`.

Runs on the Windows PC you play on — not on the NAS.

## How it flows

```
Steam 760\remote\<appid>\screenshots\*.jpg
   │  screenshot-sync.ps1 (every 60 s)
   ▼
POST /api/ingest/screenshot ──► API stages the file, scores it
   │                             (duplicate / blurry / dark → auto-reject),
   │                             works out the game's HUD from all its shots
   ▼
vision.py detect ──► subtitle / corner / edge text boxes ──► API builds the mask
   ▼
vision.py inpaint (LaMa) ──► cleaned copy ──► API
   ▼
Quest web: review (mass-select, keep/reject, original vs cleaned) ──► Export
```

Nothing in Steam's folder is ever modified or deleted.

## Install

On the gaming PC, from this directory:

```powershell
# Reuses the shortcut watcher's API config if that is installed:
.\install-task.ps1 -WithVision

# Otherwise pass the API details:
.\install-task.ps1 -ApiBase http://100.115.171.80:3007 -ApiKey <SCROBBLE_API_KEY> -WithVision
```

`-WithVision` needs **Python 3.11+** (python.org installer; tick "Add to PATH"). It
creates a venv under `%LOCALAPPDATA%\Quest\screenshot-sync\venv`, installs
`onnxruntime-directml` (works on any DX12 GPU) plus the text detector, and downloads
the LaMa model (~200 MB) once. That's about 1 GB on disk in total. Without it,
screenshots still upload and get scored, but UI isn't removed automatically. You
can still draw boxes and download a mask for Photoshop.

Remove the task with `.\install-task.ps1 -Uninstall`.

## Older screenshots

Only shots taken **after the first run** upload automatically. For older ones:

```powershell
.\screenshot-sync.ps1 -Backfill -AppId 1145350   # one game (the folder name under 760\remote)
.\screenshot-sync.ps1 -Backfill -All             # everything
```

## Check it works

```powershell
Get-Content "$env:LOCALAPPDATA\Quest\screenshot-sync\sync.log" -Tail 20 -Wait
.\screenshot-sync.ps1 -Once          # one poll in the foreground
```

## How UI detection works

Most screenshots are deliberately UI-free, so detection has to find UI that shows
up in only a few shots, and it must leave clean shots alone.

| UI | Found by | How |
| --- | --- | --- |
| **HUD** (health, minimap, item select) | API, `screenshot-analysis.ts` | Each shot → 480×272 edge map → 8×8 blocks. A block is HUD when its edge pattern recurs in **≥ 3 different scenes**. Scenery never repeats from one scene to another; an overlay at a fixed screen position does. A shot is masked for a HUD element only when it matches **most** of that element's blocks. Needs ≥ 5 shots of the game at the same aspect ratio. |
| **Subtitles** | PC, `vision.py detect` | Text boxes centred in the bottom 35% of the frame. |
| **"Skip" / corner prompts** | PC, `vision.py detect` | Text within ~18% × 15% of a corner, padded sideways for the button glyph. |
| **Other edge text** (ammo, item names) | PC, `vision.py detect` | Text hugging a screen edge. |
| **Anything missed** | You | **Draw box** in the review lightbox. Saving re-queues the fill. |

Text in the middle of the frame (signs, posters, books) is **never** treated as UI.
The text detector only finds where text is; it never reads it.

**Filling:** `vision.py inpaint` takes a padded square crop around each masked
region (at least 512 px, so small HUD elements are filled at native resolution).
It runs LaMa on that crop and blends the result back over **only** the masked pixels.
The rest of the frame is never resampled.

**Tuning:** the HUD thresholds are in `HUD_TUNING` / `SCREENSHOT_THRESHOLDS`
(`apps/api/src/services/screenshot-analysis.ts`). The text zones are at the top of
`vision/vision.py`.

## Files it writes

All under `%LOCALAPPDATA%\Quest\screenshot-sync\`:

| path | purpose |
| --- | --- |
| `config.json` | API base + key, if given to the installer (user-only ACL) |
| `state.json` | uploaded hashes → local path, pending files, first-run baseline |
| `sync.log` | activity log, trimmed at 2 MB |
| `work\` | scratch for masks, cleaned copies and batch files |
| `venv\`, `models\` | vision install (`-WithVision`) |

## API surface

All authenticate with `X-Api-Key: $SCROBBLE_API_KEY`.

```
POST /api/ingest/screenshot?appId=&takenAt=&sha256=[&name=]   raw image/jpeg body
     -> { status: created|duplicate|ignored, id }   422 = game not resolvable yet (retried in 30 min)
GET  /api/ingest/screenshots/detect-queue                     -> { items: [{ id, sha256 }] }
POST /api/ingest/screenshot/:id/ui-boxes                      { boxes: [{ x, y, w, h, kind }] }  (fractions 0-1)
GET  /api/ingest/screenshots/inpaint-queue                    -> { items: [{ id, sha256, maskVersion }] }
GET  /api/ingest/screenshot/:id/mask.png                      white = paint out
POST /api/ingest/screenshot/:id/cleaned?maskVersion=          raw image/jpeg body
POST /api/ingest/screenshot/:id/inpaint-failed                { maskVersion, reason }
```

A cleaned copy uploaded for an outdated `maskVersion` (because the mask changed
while painting) is discarded as `stale`, and the shot stays queued.
