import Fastify, { FastifyInstance } from 'fastify';
import cookiePlugin from '@fastify/cookie';
import corsPlugin from '@fastify/cors';
import helmetPlugin from '@fastify/helmet';
import jwtPlugin from '@fastify/jwt';
import { healthRoutes } from './routes/health.routes';
import { authRoutes } from './routes/auth.routes';
import { platformsRoutes } from './routes/platforms.routes';
import { syncRoutes } from './routes/sync.routes';
import { gamesRoutes } from './routes/games.routes';
import { libraryRoutes } from './routes/library.routes';
import { statusRoutes } from './routes/status.routes';
import { ratingsRoutes } from './routes/ratings.routes';
import { notesRoutes } from './routes/notes.routes';
import { ownershipRoutes } from './routes/ownership.routes';
import { listsRoutes } from './routes/lists.routes';
import { sessionsRoutes } from './routes/sessions.routes';
import { nowPlayingRoutes } from './routes/now-playing.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { matchingRoutes } from './routes/matching.routes';
import { importsRoutes } from './routes/imports.routes';
import { historyRoutes } from './routes/history.routes';
import { completionsRoutes } from './routes/completions.routes';
import { statsRoutes } from './routes/stats.routes';
import { discoverRoutes } from './routes/discover.routes';
import { accountRoutes } from './routes/account.routes';
import { exportRoutes } from './routes/export.routes';
import { userPlatformsRoutes } from './routes/user-platforms.routes';
import { appVersionRoutes } from './routes/app-version.routes';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: 'warn', transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    trustProxy: true,
  });

  void app.register(helmetPlugin, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  });

  void app.register(corsPlugin, {
    origin: true, // Allow all origins; sensitive endpoints are JWT-protected
    credentials: true,
  });
  void app.register(cookiePlugin);
  void app.register(jwtPlugin, {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
  });

  void app.register(healthRoutes);
  void app.register(authRoutes, { prefix: '/api/auth' });
  void app.register(platformsRoutes, { prefix: '/api' });
  void app.register(syncRoutes, { prefix: '/api' });
  void app.register(gamesRoutes, { prefix: '/api' });
  void app.register(libraryRoutes, { prefix: '/api' });
  void app.register(statusRoutes, { prefix: '/api' });
  void app.register(ratingsRoutes, { prefix: '/api' });
  void app.register(notesRoutes, { prefix: '/api' });
  void app.register(ownershipRoutes, { prefix: '/api' });
  void app.register(listsRoutes, { prefix: '/api' });
  void app.register(sessionsRoutes, { prefix: '/api' });
  void app.register(nowPlayingRoutes, { prefix: '/api' });
  void app.register(dashboardRoutes, { prefix: '/api' });
  void app.register(matchingRoutes, { prefix: '/api' });
  void app.register(importsRoutes, { prefix: '/api' });
  void app.register(historyRoutes, { prefix: '/api' });
  void app.register(completionsRoutes, { prefix: '/api' });
  void app.register(statsRoutes, { prefix: '/api' });
  void app.register(discoverRoutes, { prefix: '/api' });
  void app.register(accountRoutes, { prefix: '/api' });
  void app.register(exportRoutes, { prefix: '/api' });
  void app.register(userPlatformsRoutes, { prefix: '/api' });
  void app.register(appVersionRoutes, { prefix: '/api' });

  return app;
}
