CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS baseline_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 text NOT NULL UNIQUE,
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS domain_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL CHECK (domain IN ('A','B','C','D','E','F')),
  state text NOT NULL,
  baseline_snapshot_id uuid NOT NULL REFERENCES baseline_snapshots(id),
  approval_reference text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pair_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_run_id uuid NOT NULL REFERENCES domain_runs(id) ON DELETE CASCADE,
  pair_id text NOT NULL,
  state text NOT NULL,
  target_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(domain_run_id, pair_id)
);

CREATE TABLE IF NOT EXISTS task_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_run_id uuid NOT NULL REFERENCES pair_runs(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  target_object_id text NOT NULL,
  status text NOT NULL,
  input_hash text NOT NULL,
  output_hash text,
  task_contract jsonb NOT NULL,
  output jsonb,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(pair_run_id, task_type, input_hash)
);

CREATE TABLE IF NOT EXISTS validation_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_run_id uuid REFERENCES pair_runs(id) ON DELETE CASCADE,
  domain_run_id uuid REFERENCES domain_runs(id) ON DELETE CASCADE,
  check_id text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL,
  object_id text NOT NULL,
  object_path text NOT NULL,
  issue text NOT NULL,
  dependency_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action text,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pair_run_id IS NOT NULL OR domain_run_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS model_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  role text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  is_fallback boolean NOT NULL DEFAULT false,
  prompt_hash text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  status text NOT NULL,
  error_code text,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repair_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_run_id uuid NOT NULL REFERENCES pair_runs(id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES validation_findings(id),
  state text NOT NULL,
  target_paths jsonb NOT NULL,
  validators_to_rerun jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_run_id uuid NOT NULL REFERENCES domain_runs(id),
  release_version text NOT NULL,
  manifest jsonb NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  object_id text,
  version text,
  storage_uri text NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pair_runs_domain ON pair_runs(domain_run_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_pair ON task_runs(pair_run_id);
CREATE INDEX IF NOT EXISTS idx_validation_pair ON validation_findings(pair_run_id);
CREATE INDEX IF NOT EXISTS idx_validation_domain ON validation_findings(domain_run_id);
CREATE INDEX IF NOT EXISTS idx_model_calls_task ON model_calls(task_run_id);
