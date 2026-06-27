import { FastifyInstance } from 'fastify';

const GITHUB_REPO = 'jives00/Quest';

export async function appVersionRoutes(app: FastifyInstance) {
  app.get('/app/version', async (_req, reply) => {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { 'User-Agent': 'quest-server', Accept: 'application/vnd.github+json' } }
    );
    if (!response.ok) {
      return reply.status(502).send({ error: 'Failed to fetch release info' });
    }
    const release = await response.json() as {
      tag_name: string;
      assets: { name: string; browser_download_url: string }[];
    };
    const apk = release.assets.find((a) => a.name.endsWith('.apk'));
    if (!apk) {
      return reply.status(404).send({ error: 'No APK asset in latest release' });
    }
    return reply.send({ tag: release.tag_name, apkUrl: apk.browser_download_url });
  });
}
