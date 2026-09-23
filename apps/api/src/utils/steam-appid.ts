/** Steam appids (real and shortcut) are unsigned 32-bit. Accept the signed form
 *  too, since that is how shortcuts appear in localconfig.vdf, and the 64-bit
 *  "gameid" form (appid << 32 | flags) that older screenshot folders use, and
 *  normalize all of them to the unsigned 32-bit string. */
export function normalizeAppId(raw: string | number | undefined): string | null {
  if (raw == null || raw === '') return null;
  let n: bigint;
  try {
    n = BigInt(String(raw).trim());
  } catch {
    return null;
  }
  if (n < 0n) n += 2n ** 32n;
  if (n > 0xffffffffn) n >>= 32n;
  if (n <= 0n || n > 0xffffffffn) return null;
  return n.toString();
}

/** Shortcut appids always have the high bit set; real Steam appids never do. */
export function isShortcutAppId(appId: string): boolean {
  return BigInt(appId) >= 0x80000000n;
}
