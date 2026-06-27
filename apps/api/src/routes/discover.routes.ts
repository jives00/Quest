import { FastifyInstance } from 'fastify';
import { RowDataPacket } from 'mysql2/promise';
import { authenticate } from '../middleware/auth';
import { getPool } from '../db';
import { discoverGames, getGenres, coverUrl, rawQuery, type DiscoverCategory } from '../services/igdb.client';
import { fetchTopSellers } from '../services/steam-store.client';

const VALID_CATEGORIES = [
  'trending', 'new_releases', 'anticipated', 'top_rated',
  'steam_top_sellers', 'by_genre',
] as const;

type AllCategories = typeof VALID_CATEGORIES[number];

export async function discoverRoutes(app: FastifyInstance) {
  const auth = { preHandler: [authenticate] };

  app.get<{
    Querystring: {
      category?: string;
      page?: string;
      year?: string;
      genreId?: string;
    };
  }>('/discover', auth, async (request, reply) => {
    const { category = 'trending', page: pageStr = '1', year: yearStr, genreId: genreIdStr } = request.query;

    if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
      return reply.status(400).send({ error: 'Invalid category' });
    }

    const cat = category as AllCategories;
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const year = yearStr ? parseInt(yearStr, 10) : undefined;
    const genreId = genreIdStr ? parseInt(genreIdStr, 10) : undefined;

    if (cat === 'steam_top_sellers') {
      const sellers = await fetchTopSellers();
      return reply.send({
        category: cat,
        page: 1,
        hasNextPage: false,
        items: sellers.map(s => ({
          igdbId: null,
          steamAppId: s.appId,
          name: s.name,
          coverUrl: s.headerImage,
          year: null,
          releaseDate: null,
          summary: null,
          genres: [],
          rating: null,
          aggregatedRating: null,
          follows: null,
          hypes: null,
          libraryId: null,
          finalPrice: s.finalPrice,
          originalPrice: s.originalPrice,
          discountPct: s.discountPct,
          currency: s.currency,
        })),
      });
    }

    if (cat === 'by_genre' && !genreId) {
      return reply.send({ category: cat, page: 1, hasNextPage: false, items: [] });
    }

    let games: Awaited<ReturnType<typeof discoverGames>>;
    try {
      games = await discoverGames({
        category: cat as DiscoverCategory,
        page,
        year,
        genreId,
      });
    } catch (err) {
      request.log.error({ err, cat, page, year, genreId }, 'IGDB discover query failed');
      return reply.status(502).send({ error: 'Upstream IGDB error' });
    }

    // Batch-check which discovered games are already in the user's library
    const igdbIds = games.map(g => g.id);
    const libraryMap = new Map<number, number>();

    if (igdbIds.length > 0) {
      const pool = getPool();
      const placeholders = igdbIds.map(() => '?').join(',');
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, igdb_id FROM games WHERE igdb_id IN (${placeholders})`,
        igdbIds,
      );
      for (const row of rows) {
        libraryMap.set(row.igdb_id as number, row.id as number);
      }
    }

    return reply.send({
      category: cat,
      page,
      hasNextPage: games.length === 24,
      items: games.map(g => ({
        igdbId: g.id,
        steamAppId: null,
        name: g.name,
        coverUrl: g.cover?.image_id ? coverUrl(g.cover.image_id, 't_cover_big') : null,
        year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
        releaseDate: g.first_release_date
          ? new Date(g.first_release_date * 1000).toISOString().split('T')[0]
          : null,
        summary: g.summary ?? null,
        genres: g.genres?.map(gen => gen.name) ?? [],
        rating: g.rating ? Math.round(g.rating) : null,
        aggregatedRating: g.aggregated_rating ? Math.round(g.aggregated_rating) : null,
        follows: g.follows ?? null,
        hypes: g.hypes ?? null,
        libraryId: libraryMap.get(g.id) ?? null,
      })),
    });
  });

  // Diagnostic endpoint — run targeted IGDB test queries to pinpoint failures.
  // Hit GET /api/discover/debug from browser to see results.
  app.get('/discover/debug', async (_request, reply) => {
    const now = Math.floor(Date.now() / 1000);
    const days180ago = now - 180 * 24 * 60 * 60;
    const results: Record<string, unknown> = {};

    const tests: Array<{ key: string; endpoint: string; body: string }> = [
      {
        key: 'bare_top10',
        endpoint: 'games',
        body: 'fields id,name; sort id desc; limit 5;',
      },
      {
        key: 'with_rating',
        endpoint: 'games',
        body: 'fields id,name,rating,aggregated_rating; where aggregated_rating >= 75; sort aggregated_rating desc; limit 5;',
      },
      {
        key: 'with_category',
        endpoint: 'games',
        body: `fields id,name,category; where category = 0 & first_release_date >= ${days180ago}; sort first_release_date desc; limit 5;`,
      },
      {
        key: 'with_new_fields',
        endpoint: 'games',
        body: `fields id,name,rating_count,follows,hypes; where rating_count > 0; sort rating_count desc; limit 5;`,
      },
      {
        key: 'genres',
        endpoint: 'genres',
        body: 'fields id,name; limit 10;',
      },
    ];

    for (const t of tests) {
      try {
        results[t.key] = await rawQuery(t.endpoint, t.body);
      } catch (err) {
        results[t.key] = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    return reply.send({ now, days180ago, results });
  });

  app.get('/discover/genres', auth, async (_request, reply) => {
    const genres = await getGenres();
    return reply.send(
      genres
        .map(g => ({ id: g.id, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  });
}
