import type { Pool } from "pg";
import { insertRowOutcome } from "@/lib/outcomes";
import { insertImportedPerson } from "@/lib/people";
import { incrementJobCounts } from "@/lib/jobs";
import { isUniqueViolation } from "@/lib/upload";

export const DUPLICATE_EMAIL_REASON = "email already exists";

export async function commitSuccessfulRow(
  pool: Pool,
  input: {
    jobId: string;
    lineNumber: number;
    email: string;
    first_name: string;
    last_name: string;
  },
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertImportedPerson(client, {
      email: input.email,
      first_name: input.first_name,
      last_name: input.last_name,
      created_from_job_id: input.jobId,
    });
    await insertRowOutcome(client, {
      jobId: input.jobId,
      lineNumber: input.lineNumber,
      success: true,
    });
    const counted = await incrementJobCounts(client, input.jobId, "success");
    if (!counted) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      return commitFailedRow(pool, {
        jobId: input.jobId,
        lineNumber: input.lineNumber,
        reason: DUPLICATE_EMAIL_REASON,
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function commitFailedRow(
  pool: Pool,
  input: {
    jobId: string;
    lineNumber: number;
    reason: string;
  },
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertRowOutcome(client, {
      jobId: input.jobId,
      lineNumber: input.lineNumber,
      success: false,
      failureReason: input.reason,
    });
    const counted = await incrementJobCounts(client, input.jobId, "failure");
    if (!counted) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
