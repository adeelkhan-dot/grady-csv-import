import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { closePool, getPool } from "@/lib/db";
import { createQueuedJob } from "@/lib/jobs";
import { migrate } from "@/lib/migrate";
import { findOperatorByEmail } from "@/lib/operators";
import { seedOperator } from "@/lib/seed";

const pool = getPool();
let operatorId: string;
let uploadDir: string;
let previousUploadDir: string | undefined;

beforeAll(async () => {
  previousUploadDir = process.env.UPLOAD_DIR;
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "grady-schema-"));
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

test("import_jobs has processing counts, nullable error, and allowed statuses", async () => {
  const job = await createQueuedJob(pool, {
    operatorId,
    originalFilename: `schema-status-${Date.now()}.csv`,
    bytes: Buffer.from("email,first_name,last_name\n"),
  });

  expect(job.status).toBe("queued");
  expect(job.processed).toBe(0);
  expect(job.success).toBe(0);
  expect(job.failure).toBe(0);
  expect(job.error_message).toBeNull();

  for (const status of [
    "processing",
    "completed",
    "completed_with_errors",
    "failed",
  ]) {
    await pool.query("UPDATE import_jobs SET status = $1 WHERE id = $2", [
      status,
      job.id,
    ]);
  }

  await expect(
    pool.query("UPDATE import_jobs SET status = $1 WHERE id = $2", [
      "unknown",
      job.id,
    ]),
  ).rejects.toThrow();
});

test("imported_people emails are unique and row outcomes are unique per job line", async () => {
  const job = await createQueuedJob(pool, {
    operatorId,
    originalFilename: `schema-people-${Date.now()}.csv`,
    bytes: Buffer.from("email,first_name,last_name\n"),
  });

  await pool.query(
    `INSERT INTO imported_people (email, first_name, last_name, created_from_job_id)
     VALUES ($1, $2, $3, $4)`,
    [`schema-unique-${randomUUID()}@example.com`, "Pat", "Lee", job.id],
  );
  const email = (
    await pool.query<{ email: string }>(
      "SELECT email FROM imported_people WHERE created_from_job_id = $1",
      [job.id],
    )
  ).rows[0].email;
  await expect(
    pool.query(
      `INSERT INTO imported_people (email, first_name, last_name, created_from_job_id)
       VALUES ($1, $2, $3, $4)`,
      [email, "Other", "Name", job.id],
    ),
  ).rejects.toThrow();

  await pool.query(
    `INSERT INTO import_row_outcomes (job_id, line_number, success, failure_reason)
     VALUES ($1, 2, true, NULL)`,
    [job.id],
  );
  await expect(
    pool.query(
      `INSERT INTO import_row_outcomes (job_id, line_number, success, failure_reason)
       VALUES ($1, 2, false, 'duplicate line')`,
      [job.id],
    ),
  ).rejects.toThrow();
});

test("queued filename uniqueness index is unchanged", async () => {
  const index = await pool.query<{ indexdef: string }>(
    `SELECT pg_get_indexdef(oid) AS indexdef
     FROM pg_class
     WHERE relname = 'import_jobs_queued_operator_filename'`,
  );
  expect(index.rows[0].indexdef).toContain("status")
  expect(index.rows[0].indexdef).toContain("'queued'");
});
