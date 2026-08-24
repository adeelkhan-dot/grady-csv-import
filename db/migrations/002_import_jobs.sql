CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators (id),
  original_filename text NOT NULL,
  stored_path text NOT NULL,
  size_bytes integer NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_queued_operator_filename
  ON import_jobs (operator_id, original_filename)
  WHERE status = 'queued';
