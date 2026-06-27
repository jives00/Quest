-- Games the user has explicitly deleted should never be re-imported by a sync
-- poller. This table records (source, external_id) pairs that resolveExternalId
-- must skip, even when the platform still reports them.
CREATE TABLE IF NOT EXISTS ignored_external_ids (
  source       VARCHAR(32)  NOT NULL,
  external_id  VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source, external_id)
);
