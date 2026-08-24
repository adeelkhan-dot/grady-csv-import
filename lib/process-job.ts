import type { Pool } from "pg";
import { commitFailedRow, commitSuccessfulRow } from "@/lib/commit-row";
import { parseImportCsv } from "@/lib/csv";
import { failJob, finishJob, type ImportJob } from "@/lib/jobs";
import { readJobFile } from "@/lib/storage";

export const FILE_UNREADABLE_ERROR = "File could not be read";

export async function processImportJob(pool: Pool, job: ImportJob): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = await readJobFile(job.stored_path);
  } catch {
    await failJob(pool, job.id, FILE_UNREADABLE_ERROR);
    return;
  }

  const parsed = parseImportCsv(bytes);
  if (!parsed.ok) {
    await failJob(pool, job.id, parsed.error);
    return;
  }

  for (const row of parsed.rows) {
    if (row.kind === "valid") {
      await commitSuccessfulRow(pool, {
        jobId: job.id,
        lineNumber: row.lineNumber,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
      });
    } else {
      await commitFailedRow(pool, {
        jobId: job.id,
        lineNumber: row.lineNumber,
        reason: row.reason,
      });
    }
  }

  await finishJob(pool, job.id);
}
