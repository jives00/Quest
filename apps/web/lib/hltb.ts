import type { LibraryGame } from "@/lib/api";

export interface HltbEstimate {
  hours: number;
  /** Which HLTB stat this estimate came from. */
  label: string;
}

/**
 * Preferred HLTB estimate for a game: Main + Extras, falling back to Main Story
 * and then Completionist when the preferred stat is missing.
 */
export function hltbEstimate(game: LibraryGame): HltbEstimate | null {
  const candidates: [number | null | undefined, string][] = [
    [game.hltbMainExtraHours, "main + extras"],
    [game.hltbMainHours, "main story"],
    [game.hltbCompletionistHours, "completionist"],
  ];
  for (const [hours, label] of candidates) {
    if (hours != null && hours > 0) return { hours, label };
  }
  return null;
}

/** Compact hour label — whole hours once past 10h, one decimal below that. */
export function formatHltbHours(hours: number): string {
  return `${hours >= 10 ? Math.round(hours) : Number(hours.toFixed(1))}h`;
}
