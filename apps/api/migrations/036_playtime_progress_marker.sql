-- Session reconstruction charged every cumulative-playtime delta against the time
-- since the LAST POLL (playtime_totals.last_synced_at, which every poll rewrites).
-- Upstreams flush cumulative playtime in bursts larger than one poll interval, so
-- ordinary play routinely tripped the "delta exceeds elapsed wall time" guard and
-- was dropped from play_sessions entirely -- the totals stayed correct (they are a
-- straight copy of the upstream number) while roughly half of real play never
-- became a session, so it was invisible on every stats/history view.
--
-- Track when we last ACCOUNTED for progress, separately from when we last polled,
-- so a burst is charged against the whole window it actually accrued in.
ALTER TABLE playtime_totals
  ADD COLUMN last_progress_at DATETIME NULL AFTER last_synced_at;

-- Backfill: the end of the newest derived session is the last moment we know was
-- accounted for. Rows that never produced a session fall back to last_synced_at
-- (their baseline), which is what the old code effectively assumed.
UPDATE playtime_totals pt
LEFT JOIN (
  SELECT user_id, game_id, source, MAX(ended_at) AS max_end
  FROM play_sessions
  GROUP BY user_id, game_id, source
) s
  ON s.user_id = pt.user_id AND s.game_id = pt.game_id AND s.source = pt.source
SET pt.last_progress_at = COALESCE(s.max_end, pt.last_synced_at);
