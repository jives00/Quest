// Pure, dependency-free trusted-network logic (mirrors the Pulse implementation).
// A request is "trusted" (eligible for passwordless auto-login) when it carries no
// Cloudflare tunnel headers AND its socket peer IP falls inside a trusted range:
// loopback + all RFC1918 (LAN + docker-internal) + Tailscale.

const DEFAULT_TRUSTED_CIDRS = [
  '127.0.0.0/8',    // IPv4 loopback
  '10.0.0.0/8',     // RFC1918
  '172.16.0.0/12',  // RFC1918 (includes docker bridge gateways / the web container)
  '192.168.0.0/16', // RFC1918 (home LAN)
  '100.64.0.0/10',  // Tailscale (CGNAT)
];

// Tailscale IPv6 ULA prefix (fd7a:115c:a1e0::/48) — matched by string prefix.
const TAILSCALE_IPV6_PREFIX = 'fd7a:115c:a1e0';

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

// Strip an IPv4-mapped IPv6 prefix (e.g. "::ffff:192.168.0.5" -> "192.168.0.5").
export function normalizeIp(raw: string | undefined | null): string {
  if (!raw) return '';
  const ip = raw.trim();
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return mapped ? mapped[1] : ip;
}

export function parseTrustedCidrs(extra?: string | null): string[] {
  const additions = (extra ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...DEFAULT_TRUSTED_CIDRS, ...additions];
}

export function isTrustedIp(rawIp: string | undefined | null, extraCidrs?: string | null): boolean {
  const ip = normalizeIp(rawIp);
  if (!ip) return false;
  if (ip === '::1') return true; // IPv6 loopback
  if (ip.toLowerCase().startsWith(TAILSCALE_IPV6_PREFIX)) return true;
  return parseTrustedCidrs(extraCidrs).some((cidr) => ipv4InCidr(ip, cidr));
}

// A request is trusted only when it carries no Cloudflare (public-tunnel) headers
// AND its socket peer IP is within the trusted ranges. Pass the raw socket
// remoteAddress (NOT request.ip) so a spoofed X-Forwarded-For cannot grant trust —
// for the browser→Next→API proxy path this is the web container's private IP.
export function isTrustedClient(
  headers: Record<string, unknown>,
  remoteAddress: string | undefined | null,
  extraCidrs?: string | null,
): boolean {
  if (headers['cf-connecting-ip'] || headers['cf-ray']) return false;
  return isTrustedIp(remoteAddress, extraCidrs);
}
