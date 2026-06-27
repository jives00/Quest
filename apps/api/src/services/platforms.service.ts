import { RowDataPacket } from 'mysql2/promise';
import { getPool } from '../db';
import type { Platform } from '../platforms';

export interface PlatformAccount {
  platform: Platform;
  steamId64: string | null;
  hasNpsso: boolean;
  xuid: string | null;
  gamertag: string | null;
  enabled: boolean;
  health: 'green' | 'amber' | 'red';
  lastError: string | null;
  lastSyncedAt: string | null;
  lastImportedAt: string | null;
  credentialExpiresAt: string | null;
}

export async function listAccounts(userId: number): Promise<PlatformAccount[]> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT platform, steam_id64, npsso_token, xuid, gamertag, enabled, health, last_error,
            last_synced_at, last_imported_at, credential_expires_at
       FROM platform_accounts WHERE user_id = ?`,
    [userId],
  );
  return rows.map(r => ({
    platform: r.platform as Platform,
    steamId64: r.steam_id64 as string | null,
    hasNpsso: !!r.npsso_token,
    xuid: r.xuid as string | null,
    gamertag: r.gamertag as string | null,
    enabled: !!r.enabled,
    health: r.health as 'green' | 'amber' | 'red',
    lastError: r.last_error as string | null,
    lastSyncedAt: r.last_synced_at as string | null,
    lastImportedAt: r.last_imported_at as string | null,
    credentialExpiresAt: r.credential_expires_at as string | null,
  }));
}

export async function upsertSteamAccount(
  userId: number,
  steamId64: string,
  enabled = true,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO platform_accounts (user_id, platform, steam_id64, enabled, health)
     VALUES (?, 'steam', ?, ?, 'green')
     ON DUPLICATE KEY UPDATE steam_id64 = VALUES(steam_id64), enabled = VALUES(enabled)`,
    [userId, steamId64, enabled],
  );
}

/** Paste-and-go NPSSO. Stored credential lives ~2 months; saving resets health to
 *  green (optimistic) — the next sync flips it red if the token is already dead. */
export async function upsertPsnAccount(
  userId: number,
  npsso: string,
  enabled = true,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO platform_accounts (user_id, platform, npsso_token, enabled, health, last_error)
     VALUES (?, 'psn', ?, ?, 'green', NULL)
     ON DUPLICATE KEY UPDATE npsso_token = VALUES(npsso_token), enabled = VALUES(enabled),
       health = 'green', last_error = NULL`,
    [userId, npsso, enabled],
  );
}

/** Xbox needs the resolved XUID (from gamertag) plus the global OPENXBL_API_KEY in env. */
export async function upsertXboxAccount(
  userId: number,
  xuid: string,
  gamertag: string | null,
  enabled = true,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO platform_accounts (user_id, platform, xuid, gamertag, enabled, health, last_error)
     VALUES (?, 'xbox', ?, ?, ?, 'green', NULL)
     ON DUPLICATE KEY UPDATE xuid = VALUES(xuid), gamertag = VALUES(gamertag),
       enabled = VALUES(enabled), health = 'green', last_error = NULL`,
    [userId, xuid, gamertag, enabled],
  );
}
