import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { closePool, getPool } from "@/lib/db";
import {
  COMPLETED_STATUS,
  createQueuedJob,
  FAILED_STATUS,
  getImportJob,
} from "@/lib/jobs";
import { migrate } from "@/lib/migrate";
import { findOperatorByEmail } from "@/lib/operators";
import { seedOperator } from "@/lib/seed";
import { runWorkerOnce } from "@/lib/worker";

const pool = getPool();
let operatorId: string;
let uploadDir: string;
let previousUploadDir: string | undefined;

beforeAll(async () => {
  previousUploadDir = process.env.UPLOAD_DIR;
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "grady-worker-"));
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

test("runWorkerOnce processes a queued job and leaves the CSV on disk", async () => {
  await isolateJobs();
  const email = `worker-${randomUUID()}@example.com`;
  const job = await createQueuedJob(pool, {
    operatorId,
    originalFilename: `worker-${randomUUID()}.csv`,
    bytes: Buffer.from(
      `email,first_name,last_name\n${email},Pat,Lee\n`,
      "utf8",
    ),
  });

  const claimed = await runWorkerOnce(pool);
  const after = await getImportJob(pool, job.id);
  const people = await pool.query(
    "SELECT email FROM imported_people WHERE created_from_job_id = $1",
    [job.id],
  );

  expect(claimed?.id).toBe(job.id);
  expect(after?.status).toBe(COMPLETED_STATUS);
  expect(people.rows.map((row) => row.email)).toEqual([email]);
  await access(job.stored_path);
});

test("runWorkerOnce returns null when there is no queued job", async () => {
  await isolateJobs();
  expect(await runWorkerOnce(pool)).toBeNull();
});
