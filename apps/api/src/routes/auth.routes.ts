import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import rateLimitPlugin from '@fastify/rate-limit';
import { LoginBody } from '@quest/types';
import {
  findUserByUsername,
  verifyPassword,
  createAccessToken,
  createRefreshToken,
  validateRefreshToken,
  deleteRefreshToken,
} from '../services/auth.service';
import { isTrustedRequest } from '../middleware/auth';

const COOKIE = 'quest_refreshToken';

function refreshCookieOptions(request: FastifyRequest) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && request.headers['x-forwarded-proto'] === 'https',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  };
}

export async function authRoutes(app: FastifyInstance) {
  void app.register(rateLimitPlugin, {
    max: 10,
    timeWindow: '15 minutes',
  });

  app.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = LoginBody.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: 'Invalid request body' });

    const { username, password } = result.data;
    const user = await findUserByUsername(username);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const accessToken = createAccessToken(user.id);
    const refreshToken = await createRefreshToken(user.id);

    reply.setCookie(COOKIE, refreshToken, refreshCookieOptions(request));

    // refreshToken also returned in body for future mobile clients (stored in SecureStore)
    return { accessToken, refreshToken };
  });

  // Passwordless auto-login for trusted networks (LAN / Tailscale). Issues the same
  // access token + refresh cookie as /login for the single admin (ADMIN_USERNAME) when
  // the request is trusted; otherwise 401 so the web falls back to the password form.
  app.post('/session', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isTrustedRequest(request)) {
      return reply.status(401).send({ error: 'Untrusted network' });
    }
    const adminUsername = process.env.ADMIN_USERNAME;
    const user = adminUsername ? await findUserByUsername(adminUsername) : null;
    if (!user) return reply.status(401).send({ error: 'No admin user' });

    const accessToken = createAccessToken(user.id);
    const refreshToken = await createRefreshToken(user.id);

    reply.setCookie(COOKIE, refreshToken, refreshCookieOptions(request));

    return { accessToken, refreshToken };
  });

  app.post('/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { refreshToken?: string } | null;
    const token = request.cookies[COOKIE] ?? body?.refreshToken;
    if (!token) return reply.status(401).send({ error: 'No refresh token' });

    const userId = await validateRefreshToken(token);
    if (!userId) return reply.status(401).send({ error: 'Invalid or expired refresh token' });

    return { accessToken: createAccessToken(userId) };
  });

  app.post('/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { refreshToken?: string } | null;
    const token = request.cookies[COOKIE] ?? body?.refreshToken;
    if (token) await deleteRefreshToken(token);
    reply.clearCookie(COOKIE, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && request.headers['x-forwarded-proto'] === 'https',
      sameSite: 'lax',
    });
    return reply.status(204).send();
  });
}
