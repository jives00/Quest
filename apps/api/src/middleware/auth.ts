import { FastifyRequest, FastifyReply } from 'fastify';
import { isTrustedClient } from '../utils/trustedNetwork';

// True when the request comes from a trusted network (home LAN / Tailscale / docker-internal)
// and carries no Cloudflare tunnel headers. Uses the raw socket peer address (not request.ip)
// so a spoofed X-Forwarded-For cannot fake trust. On the browser→Next→API proxy path the peer
// is the web container's private IP, which is trusted (the web is only reachable via LAN/Tailscale).
export function isTrustedRequest(request: FastifyRequest): boolean {
  return isTrustedClient(
    request.headers as Record<string, unknown>,
    request.socket.remoteAddress,
    process.env.TRUSTED_CIDRS,
  );
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    const code = (err as any)?.code as string | undefined;
    if (typeof code === 'string' && code.startsWith('FST_JWT')) {
      request.log.warn(`auth failed — ${request.method} ${request.url} (${code})`);
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    throw err;
  }
}

export async function authenticateScrobble(request: FastifyRequest, reply: FastifyReply) {
  const key = request.headers['x-api-key'] ?? (request.query as Record<string, string>)['api_key'];
  if (!key || key !== process.env.SCROBBLE_API_KEY) {
    console.log(`🔒 Scrobble auth failed — ${request.method} ${request.url} key=${key ? '(present but wrong)' : '(missing)'}`);
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}
