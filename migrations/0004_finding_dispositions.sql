CREATE TABLE IF NOT EXISTS finding_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_revision_id uuid NOT NULL REFERENCES candidate_revisions(id) ON DELETE CASCADE,
  finding_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('PAIR', 'DOMAIN')),
  disposition text NOT NULL CHECK (disposition IN ('RESOLVED', 'WAIVED', 'ACCEPTED_RISK', 'REJECTED')),
  authority text NOT NULL,
  rationale text NOT NULL CHECK (char_length(btrim(rationale)) >= 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_revision_id, finding_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_finding_dispositions_candidate
  ON finding_dispositions(candidate_revision_id);
