import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { commitSuccessfulRow, DUPLICATE_EMAIL_REASON } from "@/lib/commit-row";
import {
  DUPLICATE_HEADER_ERROR,
  EMAIL_INVALID_REASON,
  INVALID_ENCODING_ERROR,
  MISSING_HEADER_ERROR,
  UNPARSEABLE_ROW_REASON,
} from "@/lib/csv";
import { closePool, getPool } from "@/lib/db";
import {
  COMPLETED_STATUS,
  COMPLETED_WITH_ERRORS_STATUS,
  createQueuedJob,
  FAILED_STATUS,
  getImportJob,
  NO_ROWS_IMPORTED_ERROR,
  PROCESSING_STATUS,
  WORKER_INTERRUPTED_ERROR,
} from "@/lib/jobs";
import { migrate } from "@/lib/migrate";
import { findOperatorByEmail } from "@/lib/operators";
import { FILE_UNREADABLE_ERROR } from "@/lib/process-job";
import { seedOperator } from "@/lib/seed";
import { runWorkerOnce } from "@/lib/worker";

const pool = getPool();
let operatorId: string;
let uploadDir: string;
let previousUploadDir: string | undefined;

beforeAll(async () => {
  previousUploadDir = process.env.UPLOAD_DIR;
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "grady-processing-"));
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

async function queueCsv(contents: string | Buffer) {
  return createQueuedJob(pool, {
    operatorId,
    originalFilename: `proc-${randomUUID()}.csv`,
    bytes: Buffer.isBuffer(contents) ? contents : Buffer.from(contents, "utf8"),
  });
}

async function processCsv(contents: string | Buffer) {
  await isolateJobs();
  const job = await queueCsv(contents);
  await runWorkerOnce(pool);
  return getImportJob(pool, job.id).then((after) => ({ job, after: after! }));
}

async function peopleFor(jobId: string) {
  return pool.query<{
    email: string;
    first_name: string;
    last_name: string;
    created_from_job_id: string;
  }>(
    `SELECT email, first_name, last_name, created_from_job_id
     FROM imported_people
     WHERE created_from_job_id = $1
     ORDER BY email`,
    [jobId],
  );
}

async function outcomesFor(jobId: string) {
  return pool.query<{
    line_number: number;
    success: boolean;
    failure_reason: string | null;
  }>(
    `SELECT line_number, success, failure_reason
     FROM import_row_outcomes
     WHERE job_id = $1
     ORDER BY line_number`,
    [jobId],
  );
}

test("all-valid rows complete with people, success outcomes, and matching counts", async () => {
  const email1 = `ann-${randomUUID()}@example.com`;
  const email2 = `bob-${randomUUID()}@example.com`;
  const { job, after } = await processCsv(
    `email,first_name,last_name\n${email1},Ann,Lee\n${email2},Bob,Ng\n`,
  );

  expect(after.status).toBe(COMPLETED_STATUS);
  expect(after.error_message).toBeNull();
  expect(after.processed).toBe(2);
  expect(after.success).toBe(2);
  expect(after.failure).toBe(0);
  expect((await peopleFor(job.id)).rows).toEqual([
    {
      email: email1,
      first_name: "Ann",
      last_name: "Lee",
      created_from_job_id: job.id,
    },
    {
      email: email2,
      first_name: "Bob",
      last_name: "Ng",
      created_from_job_id: job.id,
    },
  ]);
  expect((await outcomesFor(job.id)).rows).toEqual([
    { line_number: 2, success: true, failure_reason: null },
    { line_number: 3, success: true, failure_reason: null },
  ]);
  await access(job.stored_path);
});

test("mixed rows finish completed_with_errors and keep valid people", async () => {
  const email = `mix-${randomUUID()}@example.com`;
  const { job, after } = await processCsv(
    `email,first_name,last_name\n${email},Pat,Lee\nnot-an-email,Kim,Ng\n`,
  );

  expect(after.status).toBe(COMPLETED_WITH_ERRORS_STATUS);
  expect(after.error_message).toBeNull();
  expect(after.processed).toBe(2);
  expect(after.success).toBe(1);
  expect(after.failure).toBe(1);
  expect((await peopleFor(job.id)).rows).toEqual([
    {
      email,
      first_name: "Pat",
      last_name: "Lee",
      created_from_job_id: job.id,
    },
  ]);
  expect((await outcomesFor(job.id)).rows).toEqual([
    { line_number: 2, success: true, failure_reason: null },
    { line_number: 3, success: false, failure_reason: EMAIL_INVALID_REASON },
  ]);
});

test("zero successes fail the job with a job-level error", async () => {
  const headerOnly = await processCsv("email,first_name,last_name\n");
  expect(headerOnly.after.status).toBe(FAILED_STATUS);
  expect(headerOnly.after.error_message).toBe(NO_ROWS_IMPORTED_ERROR);
  expect(headerOnly.after.processed).toBe(0);
  expect((await peopleFor(headerOnly.job.id)).rows).toEqual([]);
  expect((await outcomesFor(headerOnly.job.id)).rows).toEqual([]);

  const allBad = await processCsv(
    "email,first_name,last_name\npat@localhost,Pat,Lee\n",
  );
  expect(allBad.after.status).toBe(FAILED_STATUS);
  expect(allBad.after.error_message).toBe(NO_ROWS_IMPORTED_ERROR);
  expect((await peopleFor(allBad.job.id)).rows).toEqual([]);
  expect((await outcomesFor(allBad.job.id)).rows).toEqual([
    { line_number: 2, success: false, failure_reason: EMAIL_INVALID_REASON },
  ]);
});

test("missing, wrong, or duplicated required headers fail with no outcomes", async () => {
  const missing = await processCsv("email,first_name\npat@example.com,Pat\n");
  expect(missing.after.status).toBe(FAILED_STATUS);
  expect(missing.after.error_message).toBe(MISSING_HEADER_ERROR);
  expect((await peopleFor(missing.job.id)).rows).toEqual([]);
  expect((await outcomesFor(missing.job.id)).rows).toEqual([]);

  const wrong = await processCsv("Email,first_name,last_name\n");
  expect(wrong.after.status).toBe(FAILED_STATUS);
  expect(wrong.after.error_message).toBe(MISSING_HEADER_ERROR);
  expect((await outcomesFor(wrong.job.id)).rows).toEqual([]);

  const duplicate = await processCsv("email,email,first_name,last_name\n");
  expect(duplicate.after.status).toBe(FAILED_STATUS);
  expect(duplicate.after.error_message).toBe(DUPLICATE_HEADER_ERROR);
  expect((await outcomesFor(duplicate.job.id)).rows).toEqual([]);
});

test("extra unknown columns are ignored when required headers are present", async () => {
  const email = `extra-${randomUUID()}@example.com`;
  const { job, after } = await processCsv(
    `dept,last_name,email,first_name\neng,Lee,${email},Pat\n`,
  );
  expect(after.status).toBe(COMPLETED_STATUS);
  expect((await peopleFor(job.id)).rows[0]).toMatchObject({
    email,
    first_name: "Pat",
    last_name: "Lee",
  });
});

test("in-file duplicate emails insert the first row and fail later casing variants", async () => {
  const local = `dup-${randomUUID()}`;
  const { job, after } = await processCsv(
    `email,first_name,last_name\n${local}@example.com,Pat,Lee\n${local.toUpperCase()}@Example.COM,Other,Name\n`,
  );
  expect(after.status).toBe(COMPLETED_WITH_ERRORS_STATUS);
  expect((await peopleFor(job.id)).rows).toEqual([
    {
      email: `${local}@example.com`,
      first_name: "Pat",
      last_name: "Lee",
      created_from_job_id: job.id,
    },
  ]);
  expect((await outcomesFor(job.id)).rows).toEqual([
    { line_number: 2, success: true, failure_reason: null },
    { line_number: 3, success: false, failure_reason: DUPLICATE_EMAIL_REASON },
  ]);
});

test("already-imported email fails the row and does not update the person", async () => {
  const email = `prior-${randomUUID()}@example.com`;
  const first = await processCsv(
    `email,first_name,last_name\n${email},Pat,Lee\n`,
  );
  const second = await processCsv(
    `email,first_name,last_name\n${email},Changed,Name\n`,
  );

  expect(second.after.status).toBe(FAILED_STATUS);
  const person = await pool.query(
    "SELECT first_name, last_name, created_from_job_id FROM imported_people WHERE email = $1",
    [email],
  );
  expect(person.rows[0]).toMatchObject({
    first_name: "Pat",
    last_name: "Lee",
    created_from_job_id: first.job.id,
  });
  expect((await outcomesFor(second.job.id)).rows[0]).toEqual({
    line_number: 2,
    success: false,
    failure_reason: DUPLICATE_EMAIL_REASON,
  });
});

test("blank lines are skipped, malformed lines fail, and later rows still run", async () => {
  const email = `later-${randomUUID()}@example.com`;
  const { job, after } = await processCsv(
    `email,first_name,last_name\n\n  \n"broken,Pat,Lee\n${email},Pat,Lee\n`,
  );

  expect(after.status).toBe(COMPLETED_WITH_ERRORS_STATUS);
  expect(after.processed).toBe(2);
  expect((await outcomesFor(job.id)).rows).toEqual([
    { line_number: 4, success: false, failure_reason: UNPARSEABLE_ROW_REASON },
    { line_number: 5, success: true, failure_reason: null },
  ]);
  expect((await peopleFor(job.id)).rows[0].email).toBe(email);
});

test("emails are stored lowercase and pat@localhost is invalid", async () => {
  const local = `Case-${randomUUID()}`;
  const { job } = await processCsv(
    `email,first_name,last_name\n  ${local}@Example.COM  ,  Pat  ,  Lee  \npat@localhost,Kim,Ng\n`,
  );
  const person = await pool.query(
    "SELECT email, first_name, last_name FROM imported_people WHERE created_from_job_id = $1",
    [job.id],
  );
  expect(person.rows[0]).toEqual({
    email: `${local.toLowerCase()}@example.com`,
    first_name: "Pat",
    last_name: "Lee",
  });
  expect((await outcomesFor(job.id)).rows[1]).toEqual({
    line_number: 3,
    success: false,
    failure_reason: EMAIL_INVALID_REASON,
  });
});

test("invalid encoding and unreadable files fail the job with no people", async () => {
  const invalid = await processCsv(Buffer.from([0xe2, 0x28, 0xa1]));
  expect(invalid.after.status).toBe(FAILED_STATUS);
  expect(invalid.after.error_message).toBe(INVALID_ENCODING_ERROR);
  expect((await peopleFor(invalid.job.id)).rows).toEqual([]);
  expect((await outcomesFor(invalid.job.id)).rows).toEqual([]);

  await isolateJobs();
  const missing = await queueCsv("email,first_name,last_name\npat@example.com,Pat,Lee\n");
  await unlink(missing.stored_path);
  await runWorkerOnce(pool);
  const after = await getImportJob(pool, missing.id);
  expect(after?.status).toBe(FAILED_STATUS);
  expect(after?.error_message).toBe(FILE_UNREADABLE_ERROR);
  expect((await peopleFor(missing.id)).rows).toEqual([]);
});

test("leftover processing is failed without resume and people are kept", async () => {
  await isolateJobs();
  const email = `crash-${randomUUID()}@example.com`;
  const unread = `unread-${randomUUID()}@example.com`;
  const job = await queueCsv(
    `email,first_name,last_name\n${email},Pat,Lee\n${unread},Kim,Ng\n`,
  );
  await pool.query("UPDATE import_jobs SET status = $1 WHERE id = $2", [
    PROCESSING_STATUS,
    job.id,
  ]);
  await commitSuccessfulRow(pool, {
    jobId: job.id,
    lineNumber: 2,
    email,
    first_name: "Pat",
    last_name: "Lee",
  });

  await runWorkerOnce(pool);
  const after = await getImportJob(pool, job.id);
  expect(after?.status).toBe(FAILED_STATUS);
  expect(after?.error_message).toBe(WORKER_INTERRUPTED_ERROR);
  expect(after?.success).toBe(1);
  expect((await peopleFor(job.id)).rows).toEqual([
    {
      email,
      first_name: "Pat",
      last_name: "Lee",
      created_from_job_id: job.id,
    },
  ]);
  expect((await outcomesFor(job.id)).rows).toEqual([
    { line_number: 2, success: true, failure_reason: null },
  ]);
});
