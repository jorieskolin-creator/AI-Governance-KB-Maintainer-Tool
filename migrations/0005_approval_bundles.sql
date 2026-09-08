CREATE TABLE IF NOT EXISTS approval_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_run_id uuid NOT NULL REFERENCES domain_runs(id) ON DELETE CASCADE,
  domain_candidate_revision_id uuid NOT NULL REFERENCES candidate_revisions(id) ON DELETE CASCADE,
  domain_candidate_hash text NOT NULL,
  bundle jsonb NOT NULL,
  bundle_sha256 text NOT NULL,
  payloads jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain_candidate_hash),
  UNIQUE (domain_candidate_revision_id)
);

CREATE INDEX IF NOT EXISTS idx_approval_bundles_domain_run
  ON approval_bundles(domain_run_id);
