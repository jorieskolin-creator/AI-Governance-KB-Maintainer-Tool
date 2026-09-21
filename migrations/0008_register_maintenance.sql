CREATE TABLE IF NOT EXISTS register_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL,
  sha256 text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  git_commit_sha text,
  drive_file_id text,
  status text NOT NULL CHECK (status IN ('COMMITTED', 'SYNCED', 'SYNC_FAILED'))
);

CREATE TABLE IF NOT EXISTS sync_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES register_revisions(id) ON DELETE CASCADE,
  destination text NOT NULL CHECK (destination IN ('GITHUB', 'DRIVE')),
  status text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  detail text
);

CREATE INDEX IF NOT EXISTS register_revisions_sha256_idx ON register_revisions (sha256);
CREATE INDEX IF NOT EXISTS sync_events_revision_id_idx ON sync_events (revision_id);
