import sharp from 'sharp';
import type { UiBox } from '@quest/types';

// ---------------------------------------------------------------------------
// Pixel math for the screenshot pipeline. Pure functions over sharp-decoded raw
// buffers -- no DB, no filesystem -- so the thresholds can be tuned in one place.
// ---------------------------------------------------------------------------

/** Every threshold the auto-flags use. Tune here, nowhere else. */
export const SCREENSHOT_THRESHOLDS = {
  /** dHash Hamming distance at or below which two shots are the same frame. */
  duplicateHamming: 6,
  /** Laplacian variance below this is blurry regardless of the game. */
  blurAbsolute: 40,
  /** ...or below this fraction of the game's median sharpness (≥5 shots). */
  blurRelative: 0.3,
  /** Mean luma below this is a black / fade frame. */
  darkMean: 18,
  /** Luma std-dev below this is a flat frame: loading screen, solid fill. */
  flatStd: 6,
};

/** Analysis grid for HUD detection. 480×272 splits exactly into 8×8 blocks. */
export const HUD_GRID = { width: 480, height: 272, block: 8, cols: 60, rows: 34 };

const HUD_TUNING = {
  /** Laplacian magnitude that counts as an edge pixel. */
  edgeThreshold: 24,
  /** A block needs this many edge pixels (of 64) to carry a signature at all. */
  minEdgePixels: 6,
  /** Distinct scenes that must share a block's edge pattern to call it HUD. */
  minScenes: 3,
  /** Edge bits (of 64) two shots may differ by and still share a block pattern. */
  matchHamming: 8,
  /** Two shots are different scenes when their dHashes differ by at least this. */
  sceneHamming: 14,
  /** A shot shows a HUD block when its edge bits are within this Hamming distance. */
  presenceHamming: 12,
  /** ...and must match at least this share of an element's signature blocks. */
  presenceFraction: 0.5,
  /** Connected HUD blobs smaller than this many blocks are noise. */
  minBlobBlocks: 2,
};

export interface ScreenshotMetrics {
  width: number;
  height: number;
  dhash: bigint;
  sharpness: number;
  lumaMean: number;
  lumaStd: number;
}

/** Decode once, derive every per-shot score. */
export async function analyzeScreenshot(buf: Buffer): Promise<ScreenshotMetrics> {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('not a decodable image');

  const small = await sharp(buf)
    .resize({ width: 512 })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = small.data;
  const w = small.info.width;
  const h = small.info.height;

  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < px.length; i++) {
    sum += px[i];
    sumSq += px[i] * px[i];
  }
  const lumaMean = sum / px.length;
  const lumaStd = Math.sqrt(Math.max(0, sumSq / px.length - lumaMean * lumaMean));

  return {
    width: meta.width,
    height: meta.height,
    dhash: await dHash(buf),
    sharpness: laplacianVariance(px, w, h),
    lumaMean,
    lumaStd,
  };
}

/** 64-bit difference hash: 9×8 greyscale, one bit per horizontal gradient sign. */
async function dHash(buf: Buffer): Promise<bigint> {
  const px = await sharp(buf).resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return hash;
}

export function hamming64(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}

function laplacianAt(px: Uint8Array | Buffer, w: number, x: number, y: number): number {
  const i = y * w + x;
  return 4 * px[i] - px[i - 1] - px[i + 1] - px[i - w] - px[i + w];
}

/** Variance of the 4-neighbour Laplacian: the standard cheap focus measure. */
function laplacianVariance(px: Uint8Array | Buffer, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v = laplacianAt(px, w, x, y);
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

// ---------------------------------------------------------------------------
// HUD detection
//
// Most screenshots are deliberately UI-free, so "a pixel that is an edge in most
// shots" finds nothing. Instead: a HUD element is one whose exact edge pattern
// turns up in several shots of DIFFERENT scenes. Scenery never repeats
// pixel-for-pixel from one scene to another; an overlay drawn at a fixed screen
// position does. Edge bits rather than raw pixels, so a semi-transparent panel
// whose background changes still matches on its crisp text and borders.
// ---------------------------------------------------------------------------

/** Greyscale at the fixed HUD grid size -- stored per shot as a lossless PNG so
 *  HUD detection can be rerun after the full-res original is exported/deleted. */
export async function hudGreyPng(buf: Buffer): Promise<Buffer> {
  return sharp(buf)
    .resize(HUD_GRID.width, HUD_GRID.height, { fit: 'fill' })
    .greyscale()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Per-block 64-bit edge signatures, packed as [hi, lo] uint32 pairs so the
 * all-pairs comparison in detectHud stays in fast 32-bit integer math. A block
 * with too few edge pixels gets NO_SIG.
 */
export interface BlockSignatures {
  hi: Uint32Array;
  lo: Uint32Array;
  has: Uint8Array;
}

export async function blockSignatures(greyPng: Buffer): Promise<BlockSignatures> {
  const { data: raw } = await sharp(greyPng)
    .greyscale()
    .blur(0.6) // knock JPEG ringing below the edge threshold
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, block, cols, rows } = HUD_GRID;

  const edges = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (Math.abs(laplacianAt(raw, w, x, y)) > HUD_TUNING.edgeThreshold) edges[y * w + x] = 1;
    }
  }

  const n = cols * rows;
  const out: BlockSignatures = { hi: new Uint32Array(n), lo: new Uint32Array(n), has: new Uint8Array(n) };
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let hi = 0;
      let lo = 0;
      let count = 0;
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const e = edges[(by * block + y) * w + bx * block + x];
          count += e;
          if (y < 4) hi = ((hi << 1) | e) >>> 0;
          else lo = ((lo << 1) | e) >>> 0;
        }
      }
      const b = by * cols + bx;
      if (count >= HUD_TUNING.minEdgePixels) {
        out.hi[b] = hi;
        out.lo[b] = lo;
        out.has[b] = 1;
      }
    }
  }
  return out;
}

function popcount32(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function sigDistance(a: BlockSignatures, ai: number, b: BlockSignatures, bi: number): number {
  return popcount32((a.hi[ai] ^ b.hi[bi]) >>> 0) + popcount32((a.lo[ai] ^ b.lo[bi]) >>> 0);
}

export interface HudShotInput {
  id: number;
  dhash: bigint;
  sigs: BlockSignatures;
}

export interface HudResult {
  /** HUD block indices. */
  blocks: Set<number>;
  /** Shot id → the HUD block indices visible in that shot (dilated by one). */
  perShot: Map<number, number[]>;
}

export function detectHud(shots: HudShotInput[]): HudResult {
  const { cols, rows } = HUD_GRID;
  const nBlocks = cols * rows;

  // Scene distinctness is a property of the shot pair, not the block: precompute.
  const n = shots.length;
  const distinct = new Uint8Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = hamming64(shots[i].dhash, shots[j].dhash) >= HUD_TUNING.sceneHamming ? 1 : 0;
      distinct[i * n + j] = d;
      distinct[j * n + i] = d;
    }
  }

  // For each block: does some shot's edge pattern recur (within tolerance) in
  // at least minScenes mutually-distinct scenes? Remember which shot defined it,
  // as the reference for per-shot presence below.
  const reference = new Int32Array(nBlocks).fill(-1);
  const withSig: number[] = [];
  for (let b = 0; b < nBlocks; b++) {
    withSig.length = 0;
    for (let i = 0; i < n; i++) if (shots[i].sigs.has[b]) withSig.push(i);
    if (withSig.length < HUD_TUNING.minScenes) continue;

    search: for (const i of withSig) {
      const scenes = [i];
      for (const j of withSig) {
        if (j === i) continue;
        if (sigDistance(shots[i].sigs, b, shots[j].sigs, b) > HUD_TUNING.matchHamming) continue;
        if (scenes.every((k) => distinct[k * n + j])) {
          scenes.push(j);
          if (scenes.length >= HUD_TUNING.minScenes) {
            reference[b] = i;
            break search;
          }
        }
      }
    }
  }

  // Close small gaps (the flat interior of a HUD panel has no edges, so no
  // signature, but sits between border blocks that do), then drop isolated blobs.
  const grid = new Uint8Array(nBlocks);
  for (let b = 0; b < nBlocks; b++) if (reference[b] >= 0) grid[b] = 1;
  const closed = erode(dilate(grid));
  for (let b = 0; b < nBlocks; b++) if (closed[b]) grid[b] = 1;
  const keep = dropSmallBlobs(grid, HUD_TUNING.minBlobBlocks);
  const hud = new Set<number>();
  for (let b = 0; b < nBlocks; b++) if (keep[b]) hud.add(b);

  // Label each HUD blob and list its signature blocks, so presence can be judged
  // per element: a clean shot's scenery will match the odd sparse block by
  // chance, but not most of an element's blocks at once.
  const blobOf = labelBlobs(keep);
  const blobSigBlocks = new Map<number, number[]>();
  for (const b of hud) {
    if (reference[b] < 0) continue;
    const id = blobOf[b];
    const list = blobSigBlocks.get(id);
    if (list) list.push(b);
    else blobSigBlocks.set(id, [b]);
  }

  // Presence per shot: every blob where enough of its signature blocks match the
  // reference, then one block of halo for the outline/shadow that LaMa needs
  // masked to avoid leaving a ghost.
  const perShot = new Map<number, number[]>();
  for (const s of shots) {
    const present = new Uint8Array(nBlocks);
    let any = false;
    for (const [id, sigBlocks] of blobSigBlocks) {
      let hits = 0;
      for (const b of sigBlocks) {
        if (s.sigs.has[b] && sigDistance(s.sigs, b, shots[reference[b]].sigs, b) <= HUD_TUNING.presenceHamming) hits++;
      }
      if (hits / sigBlocks.length < HUD_TUNING.presenceFraction) continue;
      any = true;
      for (let b = 0; b < nBlocks; b++) if (blobOf[b] === id) present[b] = 1;
    }
    if (!any) {
      perShot.set(s.id, []);
      continue;
    }
    const grown = dilate(present);
    const out: number[] = [];
    for (let b = 0; b < nBlocks; b++) if (grown[b]) out.push(b);
    perShot.set(s.id, out);
  }

  return { blocks: hud, perShot };
}

/** Connected-component label per block (4-neighbour); -1 for unset blocks. */
function labelBlobs(g: Uint8Array): Int32Array {
  const { cols, rows } = HUD_GRID;
  const label = new Int32Array(g.length).fill(-1);
  let next = 0;
  for (let start = 0; start < g.length; start++) {
    if (!g[start] || label[start] >= 0) continue;
    const stack = [start];
    label[start] = next;
    while (stack.length) {
      const b = stack.pop()!;
      const x = b % cols;
      const y = Math.floor(b / cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nb = ny * cols + nx;
        if (g[nb] && label[nb] < 0) {
          label[nb] = next;
          stack.push(nb);
        }
      }
    }
    next++;
  }
  return label;
}

function dilate(g: Uint8Array): Uint8Array {
  const { cols, rows } = HUD_GRID;
  const out = new Uint8Array(g.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!g[y * cols + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out[ny * cols + nx] = 1;
        }
      }
    }
  }
  return out;
}

function erode(g: Uint8Array): Uint8Array {
  const { cols, rows } = HUD_GRID;
  const out = new Uint8Array(g.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          // Out-of-frame counts as set, so HUD hugging the screen edge survives.
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !g[ny * cols + nx]) {
            all = false;
            break;
          }
        }
      }
      if (all) out[y * cols + x] = 1;
    }
  }
  return out;
}

function dropSmallBlobs(g: Uint8Array, minSize: number): Uint8Array {
  const { cols, rows } = HUD_GRID;
  const out = new Uint8Array(g.length);
  const seen = new Uint8Array(g.length);
  for (let start = 0; start < g.length; start++) {
    if (!g[start] || seen[start]) continue;
    const blob: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const b = stack.pop()!;
      blob.push(b);
      const x = b % cols;
      const y = Math.floor(b / cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const n = ny * cols + nx;
        if (g[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (blob.length >= minSize) for (const b of blob) out[b] = 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mask rendering
// ---------------------------------------------------------------------------

/** Full-resolution PNG, white = UI to remove, black = keep. */
export async function renderMask(
  width: number,
  height: number,
  hudBlocks: number[],
  boxes: UiBox[],
): Promise<Buffer> {
  const { cols, block, width: gw, height: gh } = HUD_GRID;
  const rects: string[] = [];
  for (const b of hudBlocks) {
    const bx = b % cols;
    const by = Math.floor(b / cols);
    const x = Math.floor(((bx * block) / gw) * width);
    const y = Math.floor(((by * block) / gh) * height);
    const x2 = Math.ceil((((bx + 1) * block) / gw) * width);
    const y2 = Math.ceil((((by + 1) * block) / gh) * height);
    rects.push(`<rect x="${x}" y="${y}" width="${x2 - x}" height="${y2 - y}"/>`);
  }
  for (const box of boxes) {
    const x = Math.max(0, Math.floor(box.x * width));
    const y = Math.max(0, Math.floor(box.y * height));
    const w = Math.min(width - x, Math.ceil(box.w * width));
    const h = Math.min(height - y, Math.ceil(box.h * height));
    if (w > 0 && h > 0) rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`);
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="100%" height="100%" fill="black"/><g fill="white">${rects.join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).greyscale().png().toBuffer();
}

export function isValidBox(b: unknown): b is UiBox {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return (['x', 'y', 'w', 'h'] as const).every(
    (k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number) && (o[k] as number) >= 0 && (o[k] as number) <= 1,
  );
}
