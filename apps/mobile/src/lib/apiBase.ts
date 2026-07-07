import { API_BASES } from "./constants";

// Resolves which API base URL is actually reachable right now. The mobile app can be
// on Tailscale (use the Tailscale IP) or on the home LAN with Tailscale down (use the
// LAN IP). We health-probe all candidates in parallel and use the first that responds.

let resolvedBase: string | null = null;
let resolvePromise: Promise<string> | null = null;

async function probe(base: string, timeoutMs = 2500): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Async: returns a reachable base, caching the result. Falls back to the primary
// (without caching) if none respond, so requests still surface a real error.
export function resolveApiBase(): Promise<string> {
  if (resolvedBase) return Promise.resolve(resolvedBase);
  if (!resolvePromise) {
    resolvePromise = new Promise<string>((resolve) => {
      let remaining = API_BASES.length;
      let settled = false;
      const done = (value: string, cache: boolean) => {
        if (settled) return;
        settled = true;
        if (cache) resolvedBase = value;
        resolve(value);
      };
      API_BASES.forEach(async (base) => {
        const ok = await probe(base);
        remaining -= 1;
        if (ok) done(base, true);
        else if (remaining === 0) done(API_BASES[0], false);
      });
    }).finally(() => {
      resolvePromise = null;
    });
  }
  return resolvePromise;
}

// Sync best-effort base for render-time URL building (e.g. image URLs). Returns the
// last resolved base, or the primary until the async probe completes.
export function currentApiBase(): string {
  return resolvedBase ?? API_BASES[0];
}

// Force a re-probe, e.g. after a request failed with a network error because the
// cached base became unreachable (network switch, Tailscale toggled).
export function resetApiBase(): void {
  resolvedBase = null;
}
