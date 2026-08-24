import type { Pool, PoolClient } from "pg";
import { recoverAndClaimJob, type ImportJob } from "@/lib/jobs";
import { processImportJob } from "@/lib/process-job";

export const DEFAULT_WORKER_POLL_MS = 1000;

/** Session advisory lock keys: only one live worker may recover, claim, or process. */
export const WORKER_LOCK_KEY_1 = 872146;
export const WORKER_LOCK_KEY_2 = 1;

export async function tryAcquireWorkerLock(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1, $2) AS locked",
    [WORKER_LOCK_KEY_1, WORKER_LOCK_KEY_2],
  );
  return result.rows[0].locked;
}

export async function releaseWorkerLock(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_unlock($1, $2)", [
    WORKER_LOCK_KEY_1,
    WORKER_LOCK_KEY_2,
  ]);
}

export async function runWorkerOnce(pool: Pool): Promise<ImportJob | null> {
  const lockClient = await pool.connect();
  try {
    const locked = await tryAcquireWorkerLock(lockClient);
    if (!locked) {
      return null;
    }
    try {
      const job = await recoverAndClaimJob(pool);
      if (!job) {
        return null;
      }
      await processImportJob(pool, job);
      return job;
    } finally {
      await releaseWorkerLock(lockClient);
    }
  } finally {
    lockClient.release();
  }
}

export function workerPollIntervalMs(): number {
  const raw = process.env.WORKER_POLL_INTERVAL_MS;
  const parsed = raw ? Number(raw) : DEFAULT_WORKER_POLL_MS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WORKER_POLL_MS;
}
