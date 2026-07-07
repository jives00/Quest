// API base candidates, tried in order of preference by the resolver in apiBase.ts.
// Primary is the Tailscale IP (works anywhere Tailscale is up); the LAN fallback lets
// the app keep working on the home network when Tailscale is down.
export const API_BASES = [
  process.env.EXPO_PUBLIC_API_URL ?? "http://100.115.171.80:3007", // Tailscale (primary)
  process.env.EXPO_PUBLIC_API_LAN_URL ?? "http://192.168.0.105:3007", // home LAN fallback
];

// Deprecated single-base export (kept for compatibility). Prefer currentApiBase() /
// resolveApiBase() from apiBase.ts so the LAN fallback is honored.
export const API_BASE = API_BASES[0];
