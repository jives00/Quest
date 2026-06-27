// Xbox / Game Pass client via OpenXBL (xbl.io) — a hosted bridge to the Xbox Live API.
//
// One API key (OPENXBL_API_KEY) is tied to a single Xbox account (the key owner). We
// resolve the gamertag → XUID once for the {xuid}-scoped endpoints (presence,
// achievements); title history uses the self endpoint.
//
// Xbox does NOT expose reliable per-title minutes, so there are no playtime deltas
// here — Xbox contributes ownership + achievements (with unlock timestamps, the
// historical signal) + presence. Auth header is `X-Authorization`.

const XBL_BASE = 'https://xbl.io/api/v2';

export function isXboxEnabled(): boolean {
  return Boolean(process.env.OPENXBL_API_KEY);
}

function apiKey(): string {
  const k = process.env.OPENXBL_API_KEY ?? '';
  if (!k) throw new Error('OPENXBL_API_KEY must be set');
  return k;
}

async function xblGet<T>(path: string): Promise<T> {
  const res = await fetch(`${XBL_BASE}${path}`, {
    headers: {
      'X-Authorization': apiKey(),
      Accept: 'application/json',
      // titleHistory/achievements validate Accept-Language and reject the default `*`
      // ("invalid locale value: *"), so pin a real locale.
      'Accept-Language': 'en-US',
    },
  });
  if (!res.ok) throw new Error(`OpenXBL ${res.status} for ${path}`);
  const json = (await res.json()) as Record<string, unknown>;
  // OpenXBL wraps payloads in a `content` envelope (e.g. /account → {content:{profileUsers}}).
  // Unwrap it transparently so each endpoint parser sees the bare XBL response. Harmless
  // when absent (returns the body unchanged).
  return (json && typeof json === 'object' && 'content' in json ? json.content : json) as T;
}

// ---------------------------------------------------------------------------
// Exported shapes
// ---------------------------------------------------------------------------

export interface XboxTitle {
  titleId: string;
  name: string;
  imageUrl: string | null;
  lastPlayed: Date | null;
  currentAchievements: number;
  totalAchievements: number;
}

export interface XboxPresence {
  titleName: string | null;
  titleId: string | null;
}

export interface XboxAchievement {
  apiName: string;
  name: string;
  icon: string | null;
  achieved: boolean;
  unlockedAt: Date | null;
}

function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * Resolve the key owner's own XUID + gamertag via /account. The OpenXBL key is tied
 * to a single Xbox account, so this is whose library we sync — far more reliable than
 * searching a gamertag (modern gamertags/discriminators/privacy break self-search).
 * Throws (with the OpenXBL status/message) on a bad key so the UI shows the real cause.
 */
export async function getOwnProfile(): Promise<{ xuid: string; gamertag: string } | null> {
  const data = await xblGet<Record<string, unknown>>('/account');

  // OpenXBL's /account shape has shifted across versions. Pull the user object from
  // whichever wrapper this account returns, then the XUID from whichever field holds it.
  const user =
    (data?.profileUsers as Array<Record<string, unknown>> | undefined)?.[0] ??
    (data?.people as Array<Record<string, unknown>> | undefined)?.[0] ??
    (Array.isArray(data) ? (data[0] as Record<string, unknown>) : undefined) ??
    data;

  const settings = (user?.settings as Array<{ id?: string; value?: string }> | undefined) ?? [];
  const xuid =
    (user?.id as string | undefined) ??
    (user?.xuid as string | undefined) ??
    (settings.find(s => s.id === 'Xuid')?.value);

  const gamertag =
    (settings.find(s => s.id === 'Gamertag')?.value) ??
    (user?.gamertag as string | undefined) ??
    '';

  if (!xuid) {
    // Surface the real payload (truncated) so the cause is visible in the UI/logs
    // instead of a blind "no account".
    throw new Error(`unexpected /account shape: ${JSON.stringify(data).slice(0, 400)}`);
  }
  return { xuid: String(xuid), gamertag };
}

/** The key owner's played titles + per-title achievement counts. */
export async function getTitleHistory(): Promise<XboxTitle[]> {
  type RawTitle = {
    titleId?: string;
    name?: string;
    displayImage?: string;
    titleHistory?: { lastTimePlayed?: string };
    achievement?: { currentAchievements?: number; totalAchievements?: number };
  };
  const data = await xblGet<RawTitle[] | { titles?: RawTitle[] }>('/player/titleHistory');

  // OpenXBL returns the title history as a bare array (after the content unwrap); older
  // shapes nested it under `titles`. Accept either.
  const titles = Array.isArray(data) ? data : data?.titles;
  if (!Array.isArray(titles)) {
    console.warn(
      `Xbox titleHistory: unexpected shape — raw response: ${JSON.stringify(data).slice(0, 500)}`,
    );
    return [];
  }
  console.log(`Xbox titleHistory: ${titles.length} titles returned`);
  if (!titles.length) return [];

  return titles
    .filter(t => t.titleId)
    .map((t): XboxTitle => ({
      titleId: t.titleId as string,
      name: t.name ?? '',
      imageUrl: t.displayImage ?? null,
      lastPlayed: parseDate(t.titleHistory?.lastTimePlayed),
      currentAchievements: t.achievement?.currentAchievements ?? 0,
      totalAchievements: t.achievement?.totalAchievements ?? 0,
    }));
}

/** Best-effort presence — failure resolves to "not playing". */
export async function getPresence(xuid: string): Promise<XboxPresence> {
  try {
    const data = await xblGet<{
      devices?: Array<{ titles?: Array<{ name?: string; id?: string; state?: string }> }>;
    }>(`/${xuid}/presence`);

    for (const device of data?.devices ?? []) {
      const active = (device.titles ?? []).find(
        t => t.state === 'Active' && t.name && t.name !== 'Home',
      );
      if (active) return { titleName: active.name ?? null, titleId: active.id ?? null };
    }
    return { titleName: null, titleId: null };
  } catch {
    return { titleName: null, titleId: null };
  }
}

/** Achievements for a title with unlock timestamps (supports X360 + XboxOne schemas). */
export async function getAchievements(xuid: string, titleId: string): Promise<XboxAchievement[]> {
  let data: {
    achievements?: Array<{
      id?: string | number;
      name?: string;
      progressState?: string;
      progression?: { timeUnlocked?: string };
      // Legacy Xbox 360 shape:
      unlocked?: boolean;
      timeUnlocked?: string;
      mediaAssets?: Array<{ type?: string; url?: string }>;
    }>;
  };
  try {
    data = await xblGet(`/achievements/player/${xuid}/${titleId}`);
  } catch {
    return [];
  }

  const list = data?.achievements;
  if (!Array.isArray(list)) return [];

  return list
    .filter(a => a.id != null)
    .map((a): XboxAchievement => {
      const achieved = a.progressState === 'Achieved' || a.unlocked === true;
      const icon = (a.mediaAssets ?? []).find(m => m.type === 'Icon')?.url ?? null;
      return {
        apiName: String(a.id),
        name: a.name ?? `Achievement ${a.id}`,
        icon,
        achieved,
        unlockedAt: achieved
          ? parseDate(a.progression?.timeUnlocked ?? a.timeUnlocked)
          : null,
      };
    });
}
