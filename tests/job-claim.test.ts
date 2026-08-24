import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { commitSuccessfulRow } from "@/lib/commit-row";
import { closePool, getPool } from "@/lib/db";
import {
  claimQueuedJob,
  COMPLETED_STATUS,
  COMPLETED_WITH_ERRORS_STATUS,
  createQueuedJob,
  failInterruptedJobs,
  failJob,
  FAILED_STATUS,
  finishJob,
  getImportJob,
  incrementJobCounts,
  NO_ROWS_IMPORTED_ERROR,
  PROCESSING_STATUS,
  recoverAndClaimJob,
  WORKER_INTERRUPTED_ERROR,
} from "@/lib/jobs";
import { migrate } from "@/lib/migrate";
import { findOperatorByEmail } from "@/lib/operators";
import { seedOperator } from "@/lib/seed";

const pool = getPool();
let operatorId: string;
let uploadDir: string;
let previousUploadDir: string | undefined;

beforeAll(async () => {
  previousUploadDir = process.env.UPLOAD_DIR;
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "grady-claim-"));
  process.env.UPLOAD_DIR = uploadDir;
  await migrate(pool);
  await seedOperator(pool);
  const operator = await findOperatorByEmail(
    pool,
    process.env.SEED_OPERATOR_EMAIL!,
  );
  operatorId = operator!.id;
});

afterAll(async () => {
  if (previousUploadDir === undefined) {
    delete process.env.UPLOAD_DIR;
  } else {
    process.env.UPLOAD_DIR = previousUploadDir;
  }
  await rm(uploadDir, { recursive: true, force: true });
  await closePool();
});

async function isolateJobs() {
  await pool.query(
    `UPDATE import_jobs
     SET status = $1,
         error_message = 'test isolation'
     WHERE status IN ('queued', 'processing')`,
    [FAILED_STATUS],
  );
}

async function queuedJob() {
  return createQueuedJob(pool, {
    operatorId,
    originalFilename: `claim-${randomUUID()}.csv`,
    bytes: Buffer.from("email,first_name,last_name\n"),
  });
}

test("recoverAndClaimJob fails leftover processing then claims one queued job", async () => {
  await isolateJobs();
  const leftover = await queuedJob();
  const queued = await queuedJob();
  await pool.query(
    "UPDATE import_jobs SET status = $1, processed = 4, success = 3, failure = 1 WHERE id = $2",
    [PROCESSING_STATUS, leftover.id],
  );

  const claimed = await recoverAndClaimJob(pool);
  const leftoverAfter = await getImportJob(pool, leftover.id);

  expect(claimed?.id).toBe(queued.id);
  expect(claimed?.status).toBe(PROCESSING_STATUS);
  expect(claimed?.processed).toBe(0);
  expect(claimed?.success).toBe(0);
  expect(claimed?.failure).toBe(0);
  expect(claimed?.error_message).toBeNull();
  expect(leftoverAfter?.status).toBe(FAILED_STATUS);
  expect(leftoverAfter?.error_message).toBe(WORKER_INTERRUPTED_ERROR);
  expect(leftoverAfter?.success).toBe(3);
  expect(leftoverAfter?.failure).toBe(1);
});

test("claimQueuedJob does not start another job while one is processing", async () => {
  await isolateJobs();
  const first = await queuedJob();
  const claimed = await recoverAndClaimJob(pool);
  expect(claimed?.id).toBe(first.id);
  await queuedJob();

  const second = await claimQueuedJob(pool);
  expect(second).toBeNull();
});

test("finishJob sets completed, completed_with_errors, or failed from counts", async () => {
  await isolateJobs();

  const completed = await queuedJob();
  await recoverAndClaimJob(pool);
  await incrementJobCounts(pool, completed.id, "success");
  await finishJob(pool, completed.id);
  const completedAfter = await getImportJob(pool, completed.id);
  expect(completedAfter?.status).toBe(COMPLETED_STATUS);
  expect(completedAfter?.error_message).toBeNull();

  const mixed = await queuedJob();
  await recoverAndClaimJob(pool);
  await incrementJobCounts(pool, mixed.id, "success");
  await incrementJobCounts(pool, mixed.id, "failure");
  await finishJob(pool, mixed.id);
  const mixedAfter = await getImportJob(pool, mixed.id);
  expect(mixedAfter?.status).toBe(COMPLETED_WITH_ERRORS_STATUS);
  expect(mixedAfter?.error_message).toBeNull();

  const failed = await queuedJob();
  await recoverAndClaimJob(pool);
  await finishJob(pool, failed.id);
  const failedAfter = await getImportJob(pool, failed.id);
  expect(failedAfter?.status).toBe(FAILED_STATUS);
  expect(failedAfter?.error_message).toBe(NO_ROWS_IMPORTED_ERROR);
});

test("failJob sets failed with a job-level error and zero counts", async () => {
  await isolateJobs();
  const job = await queuedJob();
  await recoverAndClaimJob(pool);
  await failJob(pool, job.id, "CSV header is missing a required column");
  const after = await getImportJob(pool, job.id);
  expect(after?.status).toBe(FAILED_STATUS);
  expect(after?.error_message).toBe("CSV header is missing a required column");
  expect(after?.processed).toBe(0);
  expect(after?.success).toBe(0);
  expect(after?.failure).toBe(0);
});

test("failInterruptedJobs does not resume or delete committed people", async () => {
  await isolateJobs();
  const job = await queuedJob();
  await pool.query("UPDATE import_jobs SET status = $1 WHERE id = $2", [
    PROCESSING_STATUS,
    job.id,
  ]);
  const email = `keep-${randomUUID()}@example.com`;
  await commitSuccessfulRow(pool, {
    jobId: job.id,
    lineNumber: 2,
    email,
    first_name: "Pat",
    last_name: "Lee",
  });

  await failInterruptedJobs(pool);
  const after = await getImportJob(pool, job.id);
  const person = await pool.query(
    "SELECT email, first_name FROM imported_people WHERE email = $1",
    [email],
  );

  expect(after?.status).toBe(FAILED_STATUS);
  expect(after?.error_message).toBe(WORKER_INTERRUPTED_ERROR);
  expect(after?.success).toBe(1);
  expect(person.rows[0]).toMatchObject({ email, first_name: "Pat" });
  expect(await recoverAndClaimJob(pool)).toBeNull();
});

test("concurrent claims cannot mark two jobs processing", async () => {
  await isolateJobs();
  await queuedJob();
  await queuedJob();

  const [first, second] = await Promise.all([
    claimQueuedJob(pool),
    claimQueuedJob(pool),
  ]);
  const claimed = [first, second].filter((job) => job !== null);

  expect(claimed).toHaveLength(1);
  const processing = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM import_jobs WHERE status = $1",
    [PROCESSING_STATUS],
  );
  expect(processing.rows[0].n).toBe(1);
});
