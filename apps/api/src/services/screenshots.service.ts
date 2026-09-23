import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type {
  GameScreenshots,
  Screenshot,
  ScreenshotExportResult,
  ScreenshotFlag,
  ScreenshotInboxItem,
  ScreenshotStatus,
  ScreenshotVariant,
  UiBox,
} from '@quest/types';
import { getPool } from '../db';
import { resolveExternalId } from './matching.service';
import { fetchAppDetails } from './steam-store.client';
import { isShortcutAppId } from '../utils/steam-appid';
import {
  SCREENSHOT_THRESHOLDS as T,
  analyzeScreenshot,
  blockSignatures,
  detectHud,
  hamming64,
  hudGreyPng,
  renderMask,
  type HudShotInput,
} from './screenshot-analysis';

// ---------------------------------------------------------------------------
// Screenshot pipeline: staging, scoring, UI masks, export.
//
// Files live under SCREENSHOT_STAGING_DIR/<gameId>/, named by content hash:
//   <sha>.jpg              full-res original (deleted once exported / purged)
//   <sha>.thumb.webp       grid thumbnail (kept forever)
//   <sha>.g.png            480×272 greyscale for HUD detection (kept forever, so
//                          exported shots keep voting on what the HUD looks like)
//   <sha>.clean.jpg        LaMa output from the agent (deleted with the original)
//   <sha>.clean.thumb.webp
// Paths in the DB are relative to the staging root so the mount can move.
//
// Exported shots are copied into WALLPAPER_DIR as "<Name> (N).jpg".
// ---------------------------------------------------------------------------

const PC_PLATFORM_ID = 6;
const RESCORE_DEBOUNCE_MS = 20_000;
const MIN_SHOTS_FOR_HUD = 5;

export function stagingRoot(): string {
  return path.resolve(process.env.SCREENSHOT_STAGING_DIR ?? './data/screenshots');
}

function wallpaperDir(): string | null {
  return process.env.WALLPAPER_DIR ? path.resolve(process.env.WALLPAPER_DIR) : null;
}

function abs(rel: string): string {
  return path.join(stagingRoot(), rel);
}

function relFor(gameId: number, sha: string, suffix: string): string {
  return path.posix.join(String(gameId), `${sha}${suffix}`);
}

async function unlinkQuiet(p: string | null): Promise<void> {
  if (!p) return;
  try {
    await fs.unlink(p);
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

type ShotSource = 'steam_appid' | 'steam_nonsteam';

async function findGame(source: ShotSource, appId: string): Promise<number | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT game_id FROM external_game_ids WHERE source = ? AND external_id = ? LIMIT 1`,
    [source, appId],
  );
  return rows.length ? (rows[0].game_id as number) : null;
}

/**
 * Screenshot folders are keyed by appid: a real Steam appid, or a non-Steam
 * shortcut's local id (high bit set). Real appids unknown to Quest are resolved
 * through the normal matching pipeline via the store name; an unknown shortcut
 * needs the agent to supply its name from shortcuts.vdf.
 */
async function resolveGame(
  appId: string,
  name: string | undefined,
): Promise<{ gameId: number; source: ShotSource } | null> {
  const shortcut = isShortcutAppId(appId);
  const source: ShotSource = shortcut ? 'steam_nonsteam' : 'steam_appid';

  const known = await findGame(source, appId);
  if (known != null) return { gameId: known, source };

  let title = name?.trim();
  if (!title && !shortcut) title = (await fetchAppDetails(appId))?.name ?? undefined;
  if (!title) return null;

  const resolved = await resolveExternalId({
    source,
    externalId: appId,
    title,
    platformId: PC_PLATFORM_ID,
  });
  return resolved ? { gameId: resolved.gameId, source } : null;
}

export type IngestOutcome =
  | { status: 'created' | 'duplicate'; id: number; gameId: number }
  | { status: 'unresolved' }
  | { status: 'ignored' }
  | { status: 'hash_mismatch' };

export async function ingestScreenshot(input: {
  buf: Buffer;
  appId: string;
  name?: string;
  takenAt: Date;
  sha256?: string;
}): Promise<IngestOutcome> {
  const sha = createHash('sha256').update(input.buf).digest('hex');
  if (input.sha256 && input.sha256.toLowerCase() !== sha) return { status: 'hash_mismatch' };

  const pool = getPool();
  const [dupe] = await pool.query<RowDataPacket[]>(
    `SELECT id, game_id FROM screenshots WHERE sha256 = ?`,
    [sha],
  );
  if (dupe.length) return { status: 'duplicate', id: dupe[0].id, gameId: dupe[0].game_id };

  const game = await resolveGame(input.appId, input.name);
  if (!game) {
    // resolveGame returns null both for "no title to match on" and for an id the
    // user explicitly ignored -- distinguish so the agent stops retrying the latter.
    const [ignored] = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM ignored_external_ids WHERE source IN ('steam_appid','steam_nonsteam') AND external_id = ? LIMIT 1`,
      [input.appId],
    );
    return ignored.length ? { status: 'ignored' } : { status: 'unresolved' };
  }

  const m = await analyzeScreenshot(input.buf);
  const dir = path.join(stagingRoot(), String(game.gameId));
  await fs.mkdir(dir, { recursive: true });

  const original = relFor(game.gameId, sha, '.jpg');
  await fs.writeFile(abs(original), input.buf);
  await sharp(input.buf).resize({ width: 480 }).webp({ quality: 80 }).toFile(abs(relFor(game.gameId, sha, '.thumb.webp')));
  await fs.writeFile(abs(relFor(game.gameId, sha, '.g.png')), await hudGreyPng(input.buf));

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT IGNORE INTO screenshots
       (game_id, source, source_app_id, sha256, taken_at, width, height, staging_path,
        dhash, sharpness, luma_mean, luma_std)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      game.gameId, game.source, input.appId, sha, input.takenAt, m.width, m.height, original,
      m.dhash.toString(), m.sharpness, m.lumaMean, m.lumaStd,
    ],
  );
  if (res.affectedRows === 0) {
    // Lost a race with a concurrent upload of the same bytes.
    const [row] = await pool.query<RowDataPacket[]>(`SELECT id FROM screenshots WHERE sha256 = ?`, [sha]);
    return { status: 'duplicate', id: row[0].id, gameId: game.gameId };
  }

  scheduleRescore(game.gameId);
  return { status: 'created', id: res.insertId, gameId: game.gameId };
}

// ---------------------------------------------------------------------------
// Scoring: duplicates / blur / dark, and game-level HUD detection
// ---------------------------------------------------------------------------

const rescoreTimers = new Map<number, NodeJS.Timeout>();
const rescoreRunning = new Map<number, Promise<void>>();

/** Uploads arrive in bursts; rescore a game once the burst settles. */
export function scheduleRescore(gameId: number): void {
  const existing = rescoreTimers.get(gameId);
  if (existing) clearTimeout(existing);
  rescoreTimers.set(
    gameId,
    setTimeout(() => {
      rescoreTimers.delete(gameId);
      void rescoreGame(gameId).catch((err) => console.error(`screenshots: rescore of game ${gameId} failed:`, err));
    }, RESCORE_DEBOUNCE_MS),
  );
}

/** Serialized per game so two rescores never interleave their writes. */
export function rescoreGame(gameId: number): Promise<void> {
  const prev = rescoreRunning.get(gameId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(() => doRescore(gameId));
  rescoreRunning.set(gameId, next);
  void next.finally(() => {
    if (rescoreRunning.get(gameId) === next) rescoreRunning.delete(gameId);
  });
  return next;
}

/** Log where screenshots live, and say so loudly when the folder is missing --
 *  a local dev API without SCREENSHOT_STAGING_DIR pointed at the NAS otherwise
 *  just serves broken images for every shot the shared DB knows about. */
export async function logScreenshotConfig(): Promise<void> {
  const staging = stagingRoot();
  const wallpapers = wallpaperDir();
  let stagingOk = true;
  try {
    await fs.access(staging);
  } catch {
    stagingOk = false;
  }
  console.log(`📸 screenshots: staging ${staging}${stagingOk ? '' : ' (MISSING)'}, wallpapers ${wallpapers ?? '(WALLPAPER_DIR not set)'}`);
  if (!stagingOk) {
    console.warn('📸 screenshot staging folder not found -- set SCREENSHOT_STAGING_DIR (see .env.example)');
  }
}

/** Rescore timers are in memory, so an API restart mid-burst would leave those
 *  shots unscored. Sweep every game still in review once at boot. */
export async function rescorePendingGames(): Promise<void> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT DISTINCT game_id FROM screenshots WHERE status <> 'exported' AND staging_path IS NOT NULL`,
  );
  for (const r of rows) await rescoreGame(r.game_id as number);
}

interface ScoreRow {
  id: number;
  sha256: string;
  width: number;
  height: number;
  status: ScreenshotStatus;
  status_source: 'auto' | 'user';
  dhash: bigint;
  sharpness: number;
  luma_mean: number;
  luma_std: number;
  duplicate_of: number | null;
}

function flagsFor(row: Pick<ScoreRow, 'sharpness' | 'luma_mean' | 'luma_std' | 'duplicate_of'>, medianSharpness: number | null): ScreenshotFlag[] {
  const flags: ScreenshotFlag[] = [];
  if (row.duplicate_of != null) flags.push('duplicate');
  if (
    row.sharpness < T.blurAbsolute ||
    (medianSharpness != null && row.sharpness < medianSharpness * T.blurRelative)
  ) {
    flags.push('blurry');
  }
  if (row.luma_mean < T.darkMean || row.luma_std < T.flatStd) flags.push('dark');
  return flags;
}

async function medianSharpnessFor(gameId: number): Promise<number | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT sharpness FROM screenshots WHERE game_id = ? ORDER BY sharpness`,
    [gameId],
  );
  if (rows.length < 5) return null;
  return rows[Math.floor(rows.length / 2)].sharpness as number;
}

async function doRescore(gameId: number): Promise<void> {
  const pool = getPool();
  const [raw] = await pool.query<RowDataPacket[]>(
    `SELECT id, sha256, width, height, status, status_source, CAST(dhash AS CHAR) AS dhash,
            sharpness, luma_mean, luma_std, duplicate_of
       FROM screenshots WHERE game_id = ?`,
    [gameId],
  );
  const rows: ScoreRow[] = raw.map((r) => ({ ...(r as ScoreRow), dhash: BigInt(r.dhash as string) }));
  if (!rows.length) return;

  // --- duplicates: sharpest shot of each near-identical group is the keeper.
  // Exported shots are keepers first (already chosen); shots the user rejected
  // never are, or a kept shot would be flagged as a copy of a discarded one.
  const order = [...rows].sort((a, b) => {
    const ae = a.status === 'exported' ? 1 : 0;
    const be = b.status === 'exported' ? 1 : 0;
    return be - ae || b.sharpness - a.sharpness;
  });
  const keepers: ScoreRow[] = [];
  const dupOf = new Map<number, number | null>();
  for (const r of order) {
    const match = keepers.find((k) => hamming64(k.dhash, r.dhash) <= T.duplicateHamming);
    if (match && r.status !== 'exported') {
      dupOf.set(r.id, match.id);
    } else {
      dupOf.set(r.id, null);
      if (!(r.status === 'reject' && r.status_source === 'user')) keepers.push(r);
    }
  }

  const median = await medianSharpnessFor(gameId);
  for (const r of rows) {
    const duplicateOf = dupOf.get(r.id) ?? null;
    const flags = flagsFor({ ...r, duplicate_of: duplicateOf }, median);
    const autoStatus = r.status_source === 'auto' && r.status !== 'exported'
      ? (flags.length ? 'reject' : 'keep')
      : r.status;
    if (duplicateOf !== r.duplicate_of || autoStatus !== r.status) {
      await pool.query(`UPDATE screenshots SET duplicate_of = ?, status = ? WHERE id = ?`, [
        duplicateOf, autoStatus, r.id,
      ]);
    }
  }

  // --- HUD: per aspect ratio, since a 16:9 and a 21:9 shot put the same HUD
  // element at different grid positions.
  const groups = new Map<string, ScoreRow[]>();
  for (const r of rows) {
    const key = (r.width / r.height).toFixed(2);
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  let hudChanged = false;
  for (const group of groups.values()) {
    let perShot = new Map<number, number[]>();
    if (group.length >= MIN_SHOTS_FOR_HUD) {
      const inputs: HudShotInput[] = [];
      for (const r of group) {
        try {
          const png = await fs.readFile(abs(relFor(gameId, r.sha256, '.g.png')));
          inputs.push({ id: r.id, dhash: r.dhash, sigs: await blockSignatures(png) });
        } catch {
          /* grey copy missing -- skip this shot as evidence */
        }
      }
      perShot = detectHud(inputs).perShot;
    }
    for (const r of group) {
      const blocks = perShot.get(r.id) ?? [];
      if (await applyMaskChange(r.id, { hudBlocks: blocks })) hudChanged = true;
    }
  }
  if (hudChanged) {
    await pool.query(`UPDATE games SET hud_mask_version = hud_mask_version + 1 WHERE id = ?`, [gameId]);
  }
}

// ---------------------------------------------------------------------------
// Masks & inpainting
// ---------------------------------------------------------------------------

function parseBoxes(v: unknown): UiBox[] {
  if (v == null) return [];
  const arr = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return Array.isArray(arr) ? (arr as UiBox[]) : [];
}

function parseBlocks(v: unknown): number[] {
  if (v == null) return [];
  const arr = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return Array.isArray(arr) ? (arr as number[]) : [];
}

/**
 * Replace one of the three UI sources on a shot and keep the derived state
 * consistent: has_ui, a mask_version that bumps only on a real change, and the
 * inpaint queue. Returns whether the mask changed.
 */
export async function applyMaskChange(
  id: number,
  change: { hudBlocks?: number[]; uiBoxes?: UiBox[]; manualBoxes?: UiBox[] },
): Promise<boolean> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT hud_blocks, ui_boxes, manual_boxes, mask_version, status, staging_path
       FROM screenshots WHERE id = ?`,
    [id],
  );
  if (!rows.length) return false;
  const row = rows[0];

  const before = {
    hud: parseBlocks(row.hud_blocks),
    ui: parseBoxes(row.ui_boxes),
    manual: parseBoxes(row.manual_boxes),
  };
  const after = {
    hud: change.hudBlocks ?? before.hud,
    ui: change.uiBoxes ?? before.ui,
    manual: change.manualBoxes ?? before.manual,
  };
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  const uiBoxesArrived = change.uiBoxes !== undefined && row.ui_boxes == null;
  if (!changed && !uiBoxesArrived) return false;

  const hasUi = after.hud.length > 0 || after.ui.length > 0 || after.manual.length > 0;
  const editable = row.status !== 'exported' && row.staging_path != null;
  const version = changed ? (row.mask_version as number) + 1 : (row.mask_version as number);

  // No UI left: nothing to paint, and exporting a stale clean would be wrong.
  const inpaint = !hasUi ? 'none' : changed && editable ? 'queued' : undefined;

  await pool.query(
    `UPDATE screenshots
        SET hud_blocks = ?, ui_boxes = ?, manual_boxes = ?, has_ui = ?, mask_version = ?
            ${inpaint ? ', inpaint_status = ?, inpaint_error = NULL' : ''}
            ${!hasUi ? ", export_variant = 'original'" : ''}
      WHERE id = ?`,
    [
      JSON.stringify(after.hud),
      change.uiBoxes !== undefined || row.ui_boxes != null ? JSON.stringify(after.ui) : null,
      JSON.stringify(after.manual),
      hasUi ? 1 : 0,
      version,
      ...(inpaint ? [inpaint] : []),
      id,
    ],
  );
  return changed;
}

export async function inpaintQueue(limit = 20): Promise<{ id: number; sha256: string; maskVersion: number }[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT id, sha256, mask_version FROM screenshots
      WHERE inpaint_status = 'queued' AND has_ui = 1
        AND status <> 'exported' AND staging_path IS NOT NULL
      ORDER BY id LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ id: r.id, sha256: r.sha256, maskVersion: r.mask_version }));
}

/** Pending shots the agent has not run the text detector on yet. */
export async function detectQueue(limit = 50): Promise<{ id: number; sha256: string }[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT id, sha256 FROM screenshots
      WHERE ui_boxes IS NULL AND status <> 'exported' AND staging_path IS NOT NULL
      ORDER BY id LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({ id: r.id, sha256: r.sha256 }));
}

export async function maskPng(id: number): Promise<{ png: Buffer; maskVersion: number } | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT width, height, hud_blocks, ui_boxes, manual_boxes, mask_version FROM screenshots WHERE id = ?`,
    [id],
  );
  if (!rows.length) return null;
  const r = rows[0];
  const png = await renderMask(r.width, r.height, parseBlocks(r.hud_blocks), [
    ...parseBoxes(r.ui_boxes),
    ...parseBoxes(r.manual_boxes),
  ]);
  return { png, maskVersion: r.mask_version };
}

export type CleanOutcome = 'saved' | 'stale' | 'not_found';

export async function saveCleaned(id: number, buf: Buffer, maskVersion: number): Promise<CleanOutcome> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT game_id, sha256, mask_version, staging_path FROM screenshots WHERE id = ?`,
    [id],
  );
  if (!rows.length || rows[0].staging_path == null) return 'not_found';
  const r = rows[0];
  // The mask moved on (new HUD evidence, a hand-drawn box) while the agent was
  // painting; the row stays queued and the next pass paints the current mask.
  if (r.mask_version !== maskVersion) return 'stale';

  const clean = relFor(r.game_id, r.sha256, '.clean.jpg');
  await fs.writeFile(abs(clean), buf);
  await sharp(buf).resize({ width: 480 }).webp({ quality: 80 }).toFile(abs(relFor(r.game_id, r.sha256, '.clean.thumb.webp')));
  await pool.query(
    `UPDATE screenshots
        SET cleaned_path = ?, inpaint_status = 'done', inpaint_mask_version = ?, inpaint_error = NULL,
            export_variant = 'cleaned'
      WHERE id = ? AND mask_version = ?`,
    [clean, maskVersion, id, maskVersion],
  );
  return 'saved';
}

export async function markInpaintFailed(id: number, maskVersion: number, reason: string): Promise<void> {
  console.warn(`screenshots: inpaint failed for ${id} (mask v${maskVersion}): ${reason}`);
  await getPool().query(
    `UPDATE screenshots SET inpaint_status = 'failed', inpaint_mask_version = ?, inpaint_error = ?
      WHERE id = ? AND mask_version = ?`,
    [maskVersion, reason.slice(0, 500), id, maskVersion],
  );
}

/**
 * Put shots back on the agent's inpaint queue with their current mask -- the
 * "Retry" for a failed fill, or a re-paint of one that came out badly. A mask
 * edit re-queues on its own; this is for when the mask is already right.
 */
export async function requeueInpaint(ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const [res] = await getPool().query<ResultSetHeader>(
    `UPDATE screenshots SET inpaint_status = 'queued', inpaint_error = NULL
      WHERE id IN (?) AND has_ui = 1 AND status <> 'exported' AND staging_path IS NOT NULL`,
    [ids],
  );
  return res.affectedRows;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export async function listInbox(): Promise<ScreenshotInboxItem[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT s.game_id, g.title, g.cover_path,
            COUNT(*) AS total,
            SUM(s.status = 'keep') AS keep_count,
            SUM(s.status = 'reject' AND s.status_source = 'auto') AS auto_rejected,
            SUM(s.inpaint_status = 'done') AS cleaned,
            SUM(s.has_ui = 1 AND s.inpaint_status = 'queued') AS inpaint_pending,
            MAX(s.taken_at) AS latest
       FROM screenshots s
       JOIN games g ON g.id = s.game_id
      WHERE s.status <> 'exported' AND s.staging_path IS NOT NULL
      GROUP BY s.game_id, g.title, g.cover_path
      ORDER BY latest DESC`,
  );
  return rows.map((r) => ({
    gameId: r.game_id,
    title: r.title,
    coverPath: r.cover_path,
    total: Number(r.total),
    keep: Number(r.keep_count),
    autoRejected: Number(r.auto_rejected),
    cleaned: Number(r.cleaned),
    inpaintPending: Number(r.inpaint_pending),
    latestTakenAt: (r.latest as Date).toISOString(),
  }));
}

/** Shots still in review, and how many games they span (nav badge). */
export async function inboxCount(): Promise<{ shots: number; games: number }> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT COUNT(*) AS shots, COUNT(DISTINCT game_id) AS games
       FROM screenshots WHERE status <> 'exported' AND staging_path IS NOT NULL`,
  );
  return { shots: Number(rows[0].shots), games: Number(rows[0].games) };
}

/** Windows-safe filename stem: "Title: Sub" → "Title - Sub", reserved chars dropped. */
export function sanitizeExportName(name: string): string {
  return name
    .replace(/[™®©]/g, '')
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[<>"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highest N already used for "<name> (N).ext" in the wallpaper folder. */
async function highestExisting(dir: string, name: string): Promise<{ max: number; fileCount: number }> {
  const files = await fs.readdir(dir);
  const re = new RegExp(`^${escapeRegex(name)} \\((\\d+)\\)\\.[^.]+$`, 'i');
  let max = 0;
  for (const f of files) {
    const m = re.exec(f);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return { max, fileCount: files.length };
}

async function exportNameFor(gameId: number): Promise<{ title: string; exportName: string } | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT title, screenshot_export_name FROM games WHERE id = ?`,
    [gameId],
  );
  if (!rows.length) return null;
  return {
    title: rows[0].title,
    exportName: sanitizeExportName(rows[0].screenshot_export_name || rows[0].title),
  };
}

export async function getGameScreenshots(gameId: number): Promise<GameScreenshots | null> {
  const names = await exportNameFor(gameId);
  if (!names) return null;

  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT id, game_id, taken_at, width, height, status, status_source, sharpness, luma_mean,
            luma_std, duplicate_of, hud_blocks, ui_boxes, manual_boxes, has_ui, mask_version,
            inpaint_status, inpaint_error, cleaned_path, export_variant, staging_path, exported_name
       FROM screenshots WHERE game_id = ? ORDER BY taken_at, id`,
    [gameId],
  );
  const median = await medianSharpnessFor(gameId);

  const screenshots: Screenshot[] = rows.map((r) => ({
    id: r.id,
    gameId: r.game_id,
    takenAt: (r.taken_at as Date).toISOString(),
    width: r.width,
    height: r.height,
    status: r.status,
    statusSource: r.status_source,
    flags: flagsFor(r as ScoreRow, median),
    duplicateOf: r.duplicate_of,
    hasUi: r.has_ui === 1,
    hudBlockCount: parseBlocks(r.hud_blocks).length,
    uiBoxes: parseBoxes(r.ui_boxes),
    manualBoxes: parseBoxes(r.manual_boxes),
    inpaintStatus: r.inpaint_status,
    inpaintError: r.inpaint_error ?? null,
    hasCleaned: r.cleaned_path != null,
    exportVariant: r.export_variant,
    staged: r.staging_path != null,
    exportedName: r.exported_name,
    maskVersion: r.mask_version,
  }));

  let nextNumber: number | null = null;
  const dir = wallpaperDir();
  if (dir) {
    try {
      nextNumber = (await highestExisting(dir, names.exportName)).max + 1;
    } catch {
      nextNumber = null; // folder not mounted
    }
  }
  return { gameId, title: names.title, exportName: names.exportName, nextNumber, screenshots };
}

export async function bulkUpdate(
  ids: number[],
  change: { status?: 'keep' | 'reject'; exportVariant?: ScreenshotVariant },
): Promise<number> {
  if (!ids.length) return 0;
  const sets: string[] = [];
  const params: unknown[] = [];
  if (change.status) {
    sets.push(`status = ?`, `status_source = 'user'`);
    params.push(change.status);
  }
  if (change.exportVariant) {
    // Only shots that actually have a cleaned copy can switch to it.
    sets.push(`export_variant = IF(? = 'cleaned' AND cleaned_path IS NULL, export_variant, ?)`);
    params.push(change.exportVariant, change.exportVariant);
  }
  if (!sets.length) return 0;
  const [res] = await getPool().query<ResultSetHeader>(
    `UPDATE screenshots SET ${sets.join(', ')}
      WHERE id IN (?) AND status <> 'exported' AND staging_path IS NOT NULL`,
    [...params, ids],
  );
  return res.affectedRows;
}

export async function setExportName(gameId: number, name: string | null): Promise<void> {
  const clean = name ? sanitizeExportName(name) : '';
  await getPool().query(`UPDATE games SET screenshot_export_name = ? WHERE id = ?`, [clean || null, gameId]);
}

export class ExportError extends Error {}

/**
 * Copy every kept shot (chosen variant) into the wallpaper folder as
 * "<Name> (N).jpg", numbering on from the highest N already there, then drop the
 * staged full-res files of everything this game had in review -- exported and
 * rejected alike. Thumbnails and HUD greys stay.
 */
export async function exportGame(gameId: number): Promise<ScreenshotExportResult> {
  const dir = wallpaperDir();
  if (!dir) throw new ExportError('WALLPAPER_DIR is not configured');
  try {
    await fs.access(dir, fsConstants.W_OK);
  } catch {
    throw new ExportError(`Wallpaper folder is not writable: ${dir}`);
  }

  const names = await exportNameFor(gameId);
  if (!names) throw new ExportError('Game not found');
  if (!names.exportName) throw new ExportError('Export name is empty');

  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status, staging_path, cleaned_path, export_variant
       FROM screenshots
      WHERE game_id = ? AND status <> 'exported' AND staging_path IS NOT NULL
      ORDER BY taken_at, id`,
    [gameId],
  );

  const { max, fileCount } = await highestExisting(dir, names.exportName);
  let n = max;
  const files: string[] = [];
  let purged = 0;

  for (const r of rows) {
    const original = abs(r.staging_path);
    const cleaned = r.cleaned_path ? abs(r.cleaned_path) : null;

    if (r.status === 'keep') {
      const source = r.export_variant === 'cleaned' && cleaned ? cleaned : original;
      let fileName = '';
      // COPYFILE_EXCL: never overwrite -- if something already took N, move on.
      for (;;) {
        n += 1;
        fileName = `${names.exportName} (${n}).jpg`;
        try {
          await fs.copyFile(source, path.join(dir, fileName), fsConstants.COPYFILE_EXCL);
          break;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        }
      }
      files.push(fileName);
      await pool.query(
        `UPDATE screenshots
            SET status = 'exported', exported_name = ?, exported_at = NOW(),
                staging_path = NULL, cleaned_path = NULL
          WHERE id = ?`,
        [fileName, r.id],
      );
    } else {
      purged += 1;
      await pool.query(
        `UPDATE screenshots SET staging_path = NULL, cleaned_path = NULL WHERE id = ?`,
        [r.id],
      );
    }
    await unlinkQuiet(original);
    await unlinkQuiet(cleaned);
  }

  return { exported: files.length, purged, files, folderWasEmpty: fileCount === 0 };
}

// ---------------------------------------------------------------------------
// File access for the image routes
// ---------------------------------------------------------------------------

export type ImageKind = 'thumb' | 'full' | 'clean' | 'clean-thumb';

export async function imagePath(id: number, kind: ImageKind): Promise<string | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT game_id, sha256, staging_path, cleaned_path, exported_name FROM screenshots WHERE id = ?`,
    [id],
  );
  if (!rows.length) return null;
  const r = rows[0];
  switch (kind) {
    case 'thumb':
      return abs(relFor(r.game_id, r.sha256, '.thumb.webp'));
    case 'clean-thumb':
      return r.cleaned_path ? abs(relFor(r.game_id, r.sha256, '.clean.thumb.webp')) : null;
    case 'clean':
      return r.cleaned_path ? abs(r.cleaned_path) : null;
    case 'full': {
      if (r.staging_path) return abs(r.staging_path);
      const dir = wallpaperDir();
      return r.exported_name && dir ? path.join(dir, r.exported_name) : null;
    }
  }
}
