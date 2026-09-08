CREATE TABLE IF NOT EXISTS domain_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_run_id uuid NOT NULL UNIQUE REFERENCES domain_runs(id) ON DELETE CASCADE,
  domain_candidate_hash text NOT NULL,
  approval_bundle_sha256 text NOT NULL,
  proposed_manifest_sha256 text NOT NULL,
  release_manifest jsonb NOT NULL,
  release_payloads jsonb NOT NULL,
  release_manifest_sha256 text NOT NULL,
  approval_reference text NOT NULL CHECK (char_length(btrim(approval_reference)) > 0),
  approved_by_role text NOT NULL CHECK (approved_by_role = 'OPERATOR'),
  approved_on timestamptz NOT NULL,
  effective_from date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain_run_id, release_manifest_sha256)
);

CREATE TABLE IF NOT EXISTS publication_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_run_id uuid NOT NULL UNIQUE REFERENCES domain_runs(id) ON DELETE CASCADE,
  domain_approval_id uuid NOT NULL UNIQUE REFERENCES domain_approvals(id) ON DELETE CASCADE,
  release_manifest_sha256 text NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING', 'UPLOADING', 'PUBLISHED', 'FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  release_id uuid REFERENCES releases(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_approvals_candidate_hash
  ON domain_approvals(domain_candidate_hash);

CREATE INDEX IF NOT EXISTS idx_publication_jobs_state
  ON publication_jobs(state);
