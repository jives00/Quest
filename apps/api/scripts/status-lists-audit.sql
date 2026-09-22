-- status-lists-audit.sql
-- Full inventory: every game you own, have a status on, or have filed on a
-- list — with its status, platforms, lists, and the numbers behind them.
-- Read-only. Nothing here changes data. (user_id 1 throughout; adjust if not.)
--
-- Two things that will look odd in the `lists` column until
-- apps/api/scripts/status-lists-finalize.sql is run:
--   * Backlog and Wishlist still exist as list rows. The API hides them, but
--     this queries the tables directly. Their membership is stale — the
--     statuses are the live copy now.
--   * The VR list never appears. Its membership is derived from
--     games.vr_supported rather than stored as list_items.

-- ── The inventory ──────────────────────────────────────────────────────────
SELECT
  g.id,
  g.title,
  COALESCE(gs.status, '(no status)')                                AS status,
  (SELECT GROUP_CONCAT(DISTINCT o.platform ORDER BY o.platform SEPARATOR ', ')
     FROM ownership o
    WHERE o.user_id = 1 AND o.game_id = g.id)                       AS owned_on,
  (SELECT GROUP_CONCAT(l.name ORDER BY l.kind, l.name SEPARATOR ', ')
     FROM list_items li
     JOIN lists l ON l.id = li.list_id
    WHERE l.user_id = 1 AND li.game_id = g.id)                      AS lists,
  CASE WHEN g.vr_supported = 1 THEN 'VR' ELSE '' END                AS vr,
  CASE WHEN EXISTS (SELECT 1 FROM hidden_games h
                     WHERE h.user_id = 1 AND h.game_id = g.id)
       THEN 'hidden' ELSE '' END                                    AS hidden,
  (SELECT COUNT(*) FROM game_completions gc
    WHERE gc.user_id = 1 AND gc.game_id = g.id)                     AS completions,
  ROUND(COALESCE((SELECT SUM(pt.total_minutes) FROM playtime_totals pt
                   WHERE pt.user_id = 1 AND pt.game_id = g.id), 0) / 60, 1) AS hours
FROM games g
LEFT JOIN game_status gs ON gs.user_id = 1 AND gs.game_id = g.id
WHERE EXISTS (SELECT 1 FROM ownership o WHERE o.user_id = 1 AND o.game_id = g.id)
   OR gs.status IS NOT NULL
   OR EXISTS (SELECT 1 FROM list_items li
                JOIN lists l ON l.id = li.list_id
               WHERE l.user_id = 1 AND li.game_id = g.id)
ORDER BY FIELD(COALESCE(gs.status, 'zzz'),
               'playing', 'backlog', 'wishlist', 'completed', 'skipped'),
         g.sort_title, g.title;

-- ── Things worth a second look ─────────────────────────────────────────────

-- Owned, played for real, but no status — the sync default only files games
-- acquired from now on, so anything already in the library landed here.
SELECT g.id, g.title,
       ROUND(SUM(pt.total_minutes) / 60, 1) AS hours
  FROM games g
  JOIN playtime_totals pt ON pt.game_id = g.id AND pt.user_id = 1
  LEFT JOIN game_status gs ON gs.user_id = 1 AND gs.game_id = g.id
 WHERE gs.status IS NULL
   AND NOT EXISTS (SELECT 1 FROM hidden_games h
                    WHERE h.user_id = 1 AND h.game_id = g.id)
 GROUP BY g.id, g.title
HAVING SUM(pt.total_minutes) > 0
 ORDER BY hours DESC;

-- Status says completed, but no dated completion record exists. The stats page
-- counts completions, not status, so these are invisible in year-in-review.
SELECT g.id, g.title, gs.finished_at
  FROM game_status gs
  JOIN games g ON g.id = gs.game_id
 WHERE gs.user_id = 1 AND gs.status = 'completed'
   AND NOT EXISTS (SELECT 1 FROM game_completions gc
                    WHERE gc.user_id = 1 AND gc.game_id = gs.game_id)
 ORDER BY g.sort_title;

-- Endless candidates: lots of hours, never completed, not already on the list.
SELECT g.id, g.title, COALESCE(gs.status, '(no status)') AS status,
       ROUND(SUM(pt.total_minutes) / 60, 1) AS hours
  FROM games g
  JOIN playtime_totals pt ON pt.game_id = g.id AND pt.user_id = 1
  LEFT JOIN game_status gs ON gs.user_id = 1 AND gs.game_id = g.id
 WHERE NOT EXISTS (SELECT 1 FROM game_completions gc
                    WHERE gc.user_id = 1 AND gc.game_id = g.id)
   AND NOT EXISTS (SELECT 1 FROM list_items li
                     JOIN lists l ON l.id = li.list_id
                    WHERE l.user_id = 1 AND l.system_key = 'endless'
                      AND li.game_id = g.id)
 GROUP BY g.id, g.title, gs.status
HAVING SUM(pt.total_minutes) >= 1200
 ORDER BY hours DESC;

-- ── Making changes ─────────────────────────────────────────────────────────
-- Set a status:     UPDATE game_status SET status = 'backlog' WHERE user_id = 1 AND game_id = ?;
--   (no row yet?)   INSERT INTO game_status (user_id, game_id, status) VALUES (1, ?, 'backlog');
-- Clear a status:   DELETE FROM game_status WHERE user_id = 1 AND game_id = ?;
-- Add to a list:    INSERT IGNORE INTO list_items (list_id, game_id)
--                   SELECT id, ? FROM lists WHERE user_id = 1 AND system_key = 'endless';
-- Off a list:       DELETE li FROM list_items li JOIN lists l ON l.id = li.list_id
--                    WHERE l.user_id = 1 AND l.system_key = 'endless' AND li.game_id = ?;
-- Hide a non-game:  INSERT IGNORE INTO hidden_games (user_id, game_id) VALUES (1, ?);
