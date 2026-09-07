CREATE TABLE IF NOT EXISTS artifact_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_run_id uuid NOT NULL REFERENCES pair_runs(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no >= 1),
  input_hash text NOT NULL,
  output_hash text NOT NULL,
  output jsonb NOT NULL,
  task_contract jsonb NOT NULL,
  task_run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  superseded_revision_id uuid REFERENCES artifact_revisions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pair_run_id, task_type, revision_no)
);

CREATE TABLE IF NOT EXISTS candidate_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_run_id uuid REFERENCES pair_runs(id) ON DELETE CASCADE,
  domain_run_id uuid REFERENCES domain_runs(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('PAIR', 'DOMAIN')),
  revision_hash text NOT NULL,
  artifact_output_hashes jsonb NOT NULL,
  superseded_revision_id uuid REFERENCES candidate_revisions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope = 'PAIR' AND pair_run_id IS NOT NULL AND domain_run_id IS NULL)
    OR (scope = 'DOMAIN' AND domain_run_id IS NOT NULL AND pair_run_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_pair_hash
  ON candidate_revisions(pair_run_id, revision_hash)
  WHERE scope = 'PAIR';

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_domain_hash
  ON candidate_revisions(domain_run_id, revision_hash)
  WHERE scope = 'DOMAIN';

CREATE TABLE IF NOT EXISTS gate_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_revision_id uuid NOT NULL REFERENCES candidate_revisions(id) ON DELETE CASCADE,
  gate_name text NOT NULL,
  outcome text NOT NULL,
  validator_version text NOT NULL,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_revision_id, gate_name)
);

CREATE INDEX IF NOT EXISTS idx_artifact_revisions_pair_task
  ON artifact_revisions(pair_run_id, task_type, revision_no DESC);

CREATE INDEX IF NOT EXISTS idx_gate_results_candidate
  ON gate_results(candidate_revision_id);
