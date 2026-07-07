import { currentApiBase } from "./apiBase";

/**
 * Converts a server-relative image path to an absolute URL.
 * Cover/hero *Path fields come back as "/img/..." style paths.
 * On mobile we must prefix with API_BASE since there's no implicit origin.
 *
 * TODO: verify the exact static path prefix the API serves art under
 * (check games.routes.ts / any /img or /covers static route) before shipping.
 */
export function imgUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${currentApiBase()}${path}`;
}
