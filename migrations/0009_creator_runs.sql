CREATE TABLE IF NOT EXISTS creator_runs (
  run_id text PRIMARY KEY,
  profile_id text NOT NULL,
  kb_id text NOT NULL,
  pair_id text NOT NULL,
  input_set_id text NOT NULL,
  plan_id text NOT NULL,
  state text NOT NULL CHECK (state IN (
    'INPUTS_REQUIRED',
    'READY',
    'GENERATING',
    'REVIEW_REQUIRED',
    'READY_TO_DELIVER',
    'DELIVERING',
    'DELIVERED',
    'FAILED',
    'CANCELLED'
  )),
  interruption_state text NOT NULL DEFAULT 'NONE' CHECK (interruption_state IN (
    'NONE',
    'PROVIDER_OUTCOME_UNKNOWN',
    'PROVIDER_TIMED_OUT',
    'CANCELLED_BY_OPERATOR',
    'BUDGET_EXHAUSTED',
    'INPUT_DRIFT_PAUSED'
  )),
  run_record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creator_runs_profile_pair_idx
  ON creator_runs (profile_id, pair_id, updated_at DESC);
