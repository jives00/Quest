const KEY = "questGameNav";

interface GameNavContext {
  ids: number[];
  label: string;
}

export function saveGameNavContext(ids: number[], label: string): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ids, label }));
  } catch {}
}

export function loadGameNavContext(): GameNavContext | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GameNavContext;
  } catch {
    return null;
  }
}
