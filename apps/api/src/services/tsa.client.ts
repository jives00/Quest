// ---------------------------------------------------------------------------
// TrueSteamAchievements client — scrapes the live site for DLC grouping
// ---------------------------------------------------------------------------
// Steam's own APIs do not tag achievements by DLC/expansion, and SteamDB's
// extension endpoint is Cloudflare-gated against non-extension requests. TSA
// groups achievements by DLC and is reachable server-side, so we scrape it:
//
//   1. GET /steamgame/{appid}            -> 301 to /game/<slug>/achievements
//   2. parse /game/<slug>/dlc/<dlcSlug> links from the page -> DLC names
//   3. GET each DLC page                 -> that DLC's achievement display names
//
// TSA exposes display NAMES, not Steam api_names, so callers match by name.
// Best-effort: any failure yields `[]` and grouping is simply skipped. The
// site markup can change without notice.
//
// NOTE: TSA is behind Cloudflare, which 403s undici/global `fetch` (the bot
// fingerprint it presents) even with a browser User-Agent. Node's built-in
// `https` module with a full browser UA is accepted, so this client uses that
// directly. Verified identical on Windows and Linux (Node's bundled OpenSSL).
// ---------------------------------------------------------------------------

import { get as httpsGet } from 'https';

const HOST = 'truesteamachievements.com';
const BASE_URL = `https://${HOST}`;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export interface TsaAchievementGroup {
  /** DLC / expansion / content-update name as shown on TSA. */
  dlcName: string;
  /** Achievement display names belonging to this DLC. */
  achievementNames: string[];
}

/** Decode the handful of HTML entities that appear in TSA titles. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .trim();
}

/** GET a TSA path over `https`, following redirects. Returns body on 200, else null. */
function getHtml(path: string, redirectsLeft = 5): Promise<string | null> {
  return new Promise((resolve) => {
    const req = httpsGet(
      {
        host: HOST,
        path,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc && redirectsLeft > 0) {
          res.resume();
          const nextPath = loc.startsWith('http') ? loc.replace(BASE_URL, '') : loc;
          resolve(getHtml(nextPath, redirectsLeft - 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** Extract achievement display names from a TSA game/DLC page's achievement links. */
function parseAchievementNames(html: string): string[] {
  const re = /<a[^>]*href="\/a\d+\/[a-z0-9-]+-achievement"[^>]*>([^<]+)<\/a>/gi;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = decodeEntities(m[1]);
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * Fetch achievement-to-DLC grouping for a Steam app from TrueSteamAchievements.
 *
 * Returns `[]` on any failure (best-effort). Each group's `achievementNames`
 * are display names to be matched against the game's stored achievements.
 */
export async function getTrueSteamAchievementGroups(
  appId: number,
): Promise<TsaAchievementGroup[]> {
  const gameHtml = await getHtml(`/steamgame/${appId}`);
  if (!gameHtml) return [];

  // DLC links look like: <a href="/game/<slug>/dlc/<dlcSlug>">Name</a>
  const dlcRe = /<a href="(\/game\/[^"]+\/dlc\/[^"]+)">([^<]+)<\/a>/g;
  const dlcs = new Map<string, string>(); // href -> name
  let m: RegExpExecArray | null;
  while ((m = dlcRe.exec(gameHtml)) !== null) {
    const href = m[1];
    const name = decodeEntities(m[2]);
    if (href && name && !dlcs.has(href)) dlcs.set(href, name);
  }
  if (dlcs.size === 0) return [];

  const groups: TsaAchievementGroup[] = [];
  for (const [href, dlcName] of dlcs) {
    const dlcHtml = await getHtml(href);
    if (!dlcHtml) continue;
    const achievementNames = parseAchievementNames(dlcHtml);
    if (achievementNames.length > 0) groups.push({ dlcName, achievementNames });
    // Be polite to the site between DLC page fetches.
    await new Promise((r) => setTimeout(r, 400));
  }
  return groups;
}
