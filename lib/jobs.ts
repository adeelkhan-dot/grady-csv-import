import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { removeJobFile, writeJobFile } from "@/lib/storage";

export const QUEUED_STATUS = "queued";

export type ImportJob = {
  id: string;
  operator_id: string;
  original_filename: string;
  stored_path: string;
  size_bytes: number;
  status: string;
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
       RETURNING id, operator_id, original_filename, stored_path, size_bytes, status, created_at`,
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

export async function countJobs(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM import_jobs",
  );
  return Number(result.rows[0].count);
}
