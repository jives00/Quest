/**
 * Convert total minutes into a human-readable string.
 * e.g. 90 -> "1h 30m", 45 -> "45m", 0 -> "0m"
 */
export function formatMinutes(totalMin: number): string {
  if (totalMin <= 0) return "0m";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Compact hours formatter — shows minutes below 1h, one decimal below 100h,
 * rounded integer above. Matches the web's fmtHours behaviour.
 * e.g. 45 -> "45m", 90 -> "1.5h", 6000 -> "100h", 74100 -> "1,235h"
 */
export function formatHours(totalMin: number): string {
  if (!totalMin) return "0h";
  const h = totalMin / 60;
  if (h < 1) return `${totalMin}m`;
  if (h < 100) return `${h.toFixed(1)}h`;
  return `${Math.round(h).toLocaleString()}h`;
}

/**
 * YYYY-MM-DD key for a moment, in Central Time.
 *
 * Every server-side day bucket groups by CONVERT_TZ(..., 'America/Chicago'), so any
 * client that builds its own day keys to line up against those buckets must use CT
 * too. `toISOString().slice(0,10)` does NOT work: it is UTC, so from 7pm CT onward
 * it names tomorrow and the whole window slides a day off the data.
 *
 * Mirrors the web's `toLocaleDateString("en-CA", { timeZone: "America/Chicago" })`.
 * Falls back to the device's own calendar date if Intl has no timezone support —
 * still correct on a CT device, and never worse than the UTC bug it replaces.
 */
export function ctDateKey(d: Date): string {
  try {
    const s = d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  } catch {
    // fall through
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Format a date string (ISO or YYYY-MM-DD) as a short locale string.
 * e.g. "2024-03-15" -> "Mar 15, 2024"
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Format a date string as relative (Today, Yesterday, N days ago, or short date).
 */
export function formatRelativeDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
