import type { Pool } from "pg";
import { recoverAndClaimJob, type ImportJob } from "@/lib/jobs";
import { processImportJob } from "@/lib/process-job";

export const DEFAULT_WORKER_POLL_MS = 1000;

export async function runWorkerOnce(pool: Pool): Promise<ImportJob | null> {
  const job = await recoverAndClaimJob(pool);
  if (!job) {
    return null;
  }
  await processImportJob(pool, job);
  return job;
}

export function workerPollIntervalMs(): number {
  const raw = process.env.WORKER_POLL_INTERVAL_MS;
  const parsed = raw ? Number(raw) : DEFAULT_WORKER_POLL_MS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WORKER_POLL_MS;
}
