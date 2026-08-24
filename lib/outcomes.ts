import type { Pool, PoolClient } from "pg";

type Queryable = Pool | PoolClient;

export type RowOutcome = {
  id: string;
  job_id: string;
  line_number: number;
  success: boolean;
  failure_reason: string | null;
};

export async function insertRowOutcome(
  db: Queryable,
  input: {
    jobId: string;
    lineNumber: number;
    success: boolean;
    failureReason?: string | null;
  },
): Promise<RowOutcome> {
  const result = await db.query<RowOutcome>(
    `INSERT INTO import_row_outcomes (
       job_id, line_number, success, failure_reason
     )
     VALUES ($1, $2, $3, $4)
     RETURNING id, job_id, line_number, success, failure_reason`,
    [
      input.jobId,
      input.lineNumber,
      input.success,
      input.success ? null : (input.failureReason ?? null),
    ],
  );
  return result.rows[0];
}
