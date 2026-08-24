import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { removeJobFile, writeJobFile } from "@/lib/storage";

type Queryable = Pool | PoolClient;

export const QUEUED_STATUS = "queued";
export const PROCESSING_STATUS = "processing";
export const COMPLETED_STATUS = "completed";
export const COMPLETED_WITH_ERRORS_STATUS = "completed_with_errors";
export const FAILED_STATUS = "failed";

export const WORKER_INTERRUPTED_ERROR = "Worker interrupted";
export const NO_ROWS_IMPORTED_ERROR = "No rows were imported";

export const IMPORT_JOB_COLUMNS = `id, operator_id, original_filename, stored_path, size_bytes, status, processed, success, failure, error_message, created_at`;

export type ImportJob = {
  id: string;
  operator_id: string;
  original_filename: string;
  stored_path: string;
  size_bytes: number;
  status: string;
  processed: number;
  success: number;
  failure: number;
  error_message: string | null;
  created_at: Date;
};

export async function createQueuedJob(
  pool: Pool,
  input: {
    operatorId: string;
    originalFilename: string;
    bytes: Buffer;
  },
): Promise<ImportJob> {
  const id = randomUUID();
  const storedPath = await writeJobFile(id, input.bytes);

  try {
    const result = await pool.query<ImportJob>(
      `INSERT INTO import_jobs (
         id, operator_id, original_filename, stored_path, size_bytes, status
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${IMPORT_JOB_COLUMNS}`,
      [
        id,
        input.operatorId,
        input.originalFilename,
        storedPath,
        input.bytes.length,
        QUEUED_STATUS,
      ],
    );
    return result.rows[0];
  } catch (error) {
    await removeJobFile(storedPath);
    throw error;
  }
}

export async function getImportJob(
  db: Queryable,
  jobId: string,
): Promise<ImportJob | null> {
  const result = await db.query<ImportJob>(
    `SELECT ${IMPORT_JOB_COLUMNS} FROM import_jobs WHERE id = $1`,
    [jobId],
  );
  return result.rows[0] ?? null;
}

export async function failInterruptedJobs(pool: Pool): Promise<number> {
  const result = await pool.query(
    `UPDATE import_jobs
     SET status = $1,
         error_message = $2
     WHERE status = $3`,
    [FAILED_STATUS, WORKER_INTERRUPTED_ERROR, PROCESSING_STATUS],
  );
  return result.rowCount ?? 0;
}

export async function claimQueuedJob(pool: Pool): Promise<ImportJob | null> {
  const result = await pool.query<ImportJob>(
    `WITH next_job AS (
       SELECT id
       FROM import_jobs
       WHERE status = $1
         AND NOT EXISTS (
           SELECT 1 FROM import_jobs WHERE status = $2
         )
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE import_jobs AS jobs
     SET status = $2,
         processed = 0,
         success = 0,
         failure = 0,
         error_message = NULL
     FROM next_job
     WHERE jobs.id = next_job.id
     RETURNING jobs.id, jobs.operator_id, jobs.original_filename, jobs.stored_path, jobs.size_bytes, jobs.status, jobs.processed, jobs.success, jobs.failure, jobs.error_message, jobs.created_at`,
    [QUEUED_STATUS, PROCESSING_STATUS],
  );
  return result.rows[0] ?? null;
}

export async function recoverAndClaimJob(pool: Pool): Promise<ImportJob | null> {
  await failInterruptedJobs(pool);
  return claimQueuedJob(pool);
}

export async function failJob(
  pool: Pool,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `UPDATE import_jobs
     SET status = $2,
         error_message = $3,
         processed = 0,
         success = 0,
         failure = 0
     WHERE id = $1`,
    [jobId, FAILED_STATUS, errorMessage],
  );
}

export async function finishJob(pool: Pool, jobId: string): Promise<void> {
  await pool.query(
    `UPDATE import_jobs
     SET status = CASE
           WHEN success >= 1 AND failure = 0 THEN $2
           WHEN success >= 1 AND failure >= 1 THEN $3
           ELSE $4
         END,
         error_message = CASE
           WHEN success >= 1 THEN NULL
           ELSE $5
         END
     WHERE id = $1
       AND status = $6`,
    [
      jobId,
      COMPLETED_STATUS,
      COMPLETED_WITH_ERRORS_STATUS,
      FAILED_STATUS,
      NO_ROWS_IMPORTED_ERROR,
      PROCESSING_STATUS,
    ],
  );
}

export async function incrementJobCounts(
  db: Queryable,
  jobId: string,
  field: "success" | "failure",
): Promise<void> {
  await db.query(
    `UPDATE import_jobs
     SET processed = processed + 1,
         success = success + $2,
         failure = failure + $3
     WHERE id = $1`,
    [jobId, field === "success" ? 1 : 0, field === "failure" ? 1 : 0],
  );
}

export async function countJobs(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM import_jobs",
  );
  return Number(result.rows[0].count);
}
