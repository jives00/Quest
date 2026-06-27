import { FastifyRequest, FastifyReply } from 'fastify';

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
