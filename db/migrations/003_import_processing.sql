ALTER TABLE import_jobs
  ADD COLUMN IF NOT EXISTS processed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE import_jobs
  DROP CONSTRAINT IF EXISTS import_jobs_status_check;

ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_status_check
  CHECK (status IN (
    'queued',
    'processing',
    'completed',
    'completed_with_errors',
    'failed'
  ));

CREATE TABLE IF NOT EXISTS imported_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_from_job_id uuid NOT NULL REFERENCES import_jobs (id)
);

CREATE TABLE IF NOT EXISTS import_row_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES import_jobs (id),
  line_number integer NOT NULL,
  success boolean NOT NULL,
  failure_reason text,
  UNIQUE (job_id, line_number),
  CHECK (
    (success = true AND failure_reason IS NULL)
    OR (success = false AND failure_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_one_processing
  ON import_jobs ((true))
  WHERE status = 'processing';
