import { getPool } from '../db';
import { resolveExternalId } from './matching.service';
import { recordOwnership } from './library.service';
import { IGDB_PLATFORM_HINT, PLATFORM_LABELS, type Platform } from '../platforms';

// One-shot library imports for the cloud-API-less stores (Epic / GOG / Meta Quest).
// The user obtains an owned-games list from the platform (see Settings docs), pastes
// it in, and each entry is matched through the same matching.service as Steam/PSN —
// creating a `games` row (or provisional) + `external_game_ids` + `ownership(source)`.
// After import the games are maintained by hand; there is no poller.

export interface ImportItem {
  title: string;
  externalId?: string;
  acquiredAt?: string; // ISO date
}

export interface ImportResult {
  source: Platform;
  imported: number;
  matched: number;
  provisional: number;
  skipped: number;
}

/** Parse a pasted CSV/newline list into items. Accepts `title` or `title,externalId`
 *  per line; blank lines and a leading `title[,...]` header row are ignored. */
export function parseImportCsv(text: string): ImportItem[] {
  const items: ImportItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [title, externalId] = line.split(',').map(s => s.trim());
    if (!title || /^title$/i.test(title)) continue; // skip header
    items.push({ title, externalId: externalId || undefined });
  }
  return items;
}

/** Ensure an import-only platform_accounts row exists and stamp last_imported_at. */
async function markImported(userId: number, source: Platform): Promise<void> {
  await getPool().query(
    `INSERT INTO platform_accounts (user_id, platform, enabled, health, import_label, last_imported_at)
     VALUES (?, ?, 1, 'green', ?, NOW())
     ON DUPLICATE KEY UPDATE import_label = VALUES(import_label), last_imported_at = NOW()`,
    [userId, source, PLATFORM_LABELS[source]],
  );
}

export async function importLibrary(
  userId: number,
  source: Platform,
  items: ImportItem[],
): Promise<ImportResult> {
  const result: ImportResult = { source, imported: 0, matched: 0, provisional: 0, skipped: 0 };

  for (const item of items) {
    const title = item.title?.trim();
    if (!title) {
      result.skipped++;
      continue;
    }
    // External id is the platform's product id when known, else a normalized title so
    // re-imports are idempotent (same line → same external_game_ids row → same game).
    const externalId = item.externalId?.trim() || `title:${title.toLowerCase()}`;
    const acquiredAt = item.acquiredAt ? new Date(item.acquiredAt) : null;

    const resolved = await resolveExternalId({
      source,
      externalId,
      title,
      platformId: IGDB_PLATFORM_HINT[source],
    });
    if (!resolved) { result.skipped++; continue; }
    await recordOwnership(userId, resolved.gameId, source, acquiredAt && !isNaN(acquiredAt.getTime()) ? acquiredAt : null);

    result.imported++;
    if (resolved.matchStatus === 'matched') result.matched++;
    else if (resolved.matchStatus === 'provisional') result.provisional++;
  }

  await markImported(userId, source);
  return result;
}
