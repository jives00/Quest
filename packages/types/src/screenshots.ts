/**
 * Screenshot pipeline -- Steam screenshots uploaded by the gaming-PC agent,
 * reviewed in the web app, exported to the NAS wallpaper share.
 */

export type ScreenshotStatus = 'keep' | 'reject' | 'exported';
export type ScreenshotVariant = 'original' | 'cleaned';
export type InpaintStatus = 'none' | 'queued' | 'done' | 'failed';

/** A UI rectangle as fractions of the frame (0-1), so it is resolution-independent. */
export interface UiBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where it came from: the agent's text detector zones, or drawn by hand. */
  kind?: 'subtitle' | 'corner' | 'edge' | 'manual';
}

export type ScreenshotFlag = 'duplicate' | 'blurry' | 'dark';

export interface Screenshot {
  id: number;
  gameId: number;
  takenAt: string;
  width: number;
  height: number;
  status: ScreenshotStatus;
  /** 'user' once the user has decided; auto-flags never override that. */
  statusSource: 'auto' | 'user';
  flags: ScreenshotFlag[];
  duplicateOf: number | null;
  hasUi: boolean;
  /** HUD blocks present in this shot (from the game-level HUD detection). */
  hudBlockCount: number;
  uiBoxes: UiBox[];
  manualBoxes: UiBox[];
  inpaintStatus: InpaintStatus;
  hasCleaned: boolean;
  exportVariant: ScreenshotVariant;
  /** True while the full-res original is still in staging (not yet exported/purged). */
  staged: boolean;
  exportedName: string | null;
  /** Bumps whenever the mask changes -- append to image URLs to bust caches. */
  maskVersion: number;
}

export interface ScreenshotInboxItem {
  gameId: number;
  title: string;
  coverPath: string | null;
  total: number;
  keep: number;
  autoRejected: number;
  cleaned: number;
  /** Shots with UI still waiting on the agent to paint it out. */
  inpaintPending: number;
  latestTakenAt: string;
}

export interface GameScreenshots {
  gameId: number;
  title: string;
  exportName: string;
  /** The number the next exported file will get, e.g. 37 → "Title (37).jpg". */
  nextNumber: number | null;
  screenshots: Screenshot[];
}

export interface ScreenshotExportResult {
  exported: number;
  purged: number;
  files: string[];
  /** The wallpaper folder had no files before this export -- probably a bad mount. */
  folderWasEmpty: boolean;
}
