-- Non-Steam games launched through Steam ("Add a Non-Steam Game" shortcuts).
--
-- Steam's Web API is blind to these: GetOwnedGames never lists them, and
-- GetPlayerSummaries withholds gameid/gameextrainfo while one is running, so the
-- Steam poller cannot see them at all. They are reported instead by a watcher
-- agent on the gaming PC (see tools/shortcut-watcher/), which reads the shortcut
-- name/appid out of Steam's local shortcuts.vdf and times the session itself.
--
-- The shortcut appid is Steam-local and per-machine (it is derived from the exe
-- path + name), so it gets its own external-id source rather than sharing
-- 'steam_appid' -- a shortcut id and a real Steam appid occupy the same numeric
-- space and would otherwise collide on the (source, external_id) unique key.
ALTER TABLE external_game_ids
  MODIFY COLUMN source ENUM('igdb','steam_appid','psn_concept','rawg','xbox','epic','gog','meta_quest','steam_nonsteam') NOT NULL;

-- The watcher reports real start/end times, so unlike every polling source it
-- inserts genuine (derived = 0) sessions instead of diffing a cumulative total.
-- That makes retries unsafe without a dedupe key: a POST that succeeds but whose
-- response is lost would otherwise be replayed as a second session. The agent
-- generates one uid per session and reuses it across retries.
--
-- NULL is allowed and non-unique in MySQL, so every existing (and future
-- poller-derived) session is unaffected.
ALTER TABLE play_sessions
  ADD COLUMN client_uid VARCHAR(64) NULL AFTER derived,
  ADD UNIQUE KEY uq_play_sessions_client_uid (client_uid);
