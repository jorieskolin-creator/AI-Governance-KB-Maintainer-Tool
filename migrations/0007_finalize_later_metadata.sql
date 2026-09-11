-- "Save & Finalize Later" park metadata: a free-text reason plus an owner/category
-- so a deferred object records why it is parked and who must unblock it (e.g. Legal).
-- Additive and nullable so existing parked findings remain valid.
ALTER TABLE validation_findings
  ADD COLUMN IF NOT EXISTS park_reason text,
  ADD COLUMN IF NOT EXISTS park_owner text;
