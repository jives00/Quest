export function rarityLabel(pct: number): { label: string; className: string } {
  if (pct < 5) return { label: "Ultra Rare", className: "bg-amber-500/20 text-amber-400" };
  if (pct < 15) return { label: "Very Rare", className: "bg-purple-500/20 text-purple-400" };
  if (pct < 30) return { label: "Rare", className: "bg-blue-500/20 text-blue-400" };
  if (pct < 50) return { label: "Uncommon", className: "bg-green-500/20 text-green-400" };
  return { label: "Common", className: "bg-surface-container text-on-surface/40" };
}
