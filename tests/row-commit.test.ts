import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  commitFailedRow,
  commitSuccessfulRow,
  DUPLICATE_EMAIL_REASON,
} from "@/lib/commit-row";
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
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "grady-commit-"));
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

async function queuedJob() {
  return createQueuedJob(pool, {
    operatorId,
    originalFilename: `commit-${randomUUID()}.csv`,
    bytes: Buffer.from("email,first_name,last_name\n"),
  });
}

test("a valid row persists a person, success outcome, and matching counts", async () => {
  const job = await queuedJob();
  const email = `pat-${randomUUID()}@example.com`;

  await commitSuccessfulRow(pool, {
    jobId: job.id,
    lineNumber: 2,
    email,
    first_name: "Pat",
    last_name: "Lee",
  });

  const person = await pool.query(
    "SELECT email, first_name, last_name, created_from_job_id FROM imported_people WHERE email = $1",
    [email],
  );
  const outcome = await pool.query(
    "SELECT line_number, success, failure_reason FROM import_row_outcomes WHERE job_id = $1",
    [job.id],
  );
  const counts = await pool.query(
    "SELECT processed, success, failure FROM import_jobs WHERE id = $1",
    [job.id],
  );

  expect(person.rows[0]).toMatchObject({
    email,
    first_name: "Pat",
    last_name: "Lee",
    created_from_job_id: job.id,
  });
  expect(outcome.rows).toEqual([
    { line_number: 2, success: true, failure_reason: null },
  ]);
  expect(counts.rows[0]).toEqual({ processed: 1, success: 1, failure: 0 });
});

test("duplicate email records a failure and does not update the existing person", async () => {
  const firstJob = await queuedJob();
  const secondJob = await queuedJob();
  const email = `dup-${randomUUID()}@example.com`;

  await commitSuccessfulRow(pool, {
    jobId: firstJob.id,
    lineNumber: 2,
    email,
    first_name: "Pat",
    last_name: "Lee",
  });
  await commitSuccessfulRow(pool, {
    jobId: firstJob.id,
    lineNumber: 3,
    email: `other-${randomUUID()}@example.com`,
    first_name: "Kim",
    last_name: "Ng",
  });
  await commitSuccessfulRow(pool, {
    jobId: secondJob.id,
    lineNumber: 2,
    email,
    first_name: "Changed",
    last_name: "Name",
  });

  const person = await pool.query(
    "SELECT first_name, last_name, created_from_job_id FROM imported_people WHERE email = $1",
    [email],
  );
  const duplicateOutcome = await pool.query(
    "SELECT success, failure_reason FROM import_row_outcomes WHERE job_id = $1 AND line_number = 2",
    [secondJob.id],
  );
  const firstPeople = await pool.query(
    "SELECT count(*)::int AS n FROM imported_people WHERE created_from_job_id = $1",
    [firstJob.id],
  );
  const secondCounts = await pool.query(
    "SELECT processed, success, failure FROM import_jobs WHERE id = $1",
    [secondJob.id],
  );

  expect(person.rows[0]).toMatchObject({
    first_name: "Pat",
    last_name: "Lee",
    created_from_job_id: firstJob.id,
  });
  expect(duplicateOutcome.rows[0]).toEqual({
    success: false,
    failure_reason: DUPLICATE_EMAIL_REASON,
  });
  expect(firstPeople.rows[0].n).toBe(2);
  expect(secondCounts.rows[0]).toEqual({ processed: 1, success: 0, failure: 1 });
});

test("a failed row writes an outcome and increments failure without inserting a person", async () => {
  const job = await queuedJob();

  await commitFailedRow(pool, {
    jobId: job.id,
    lineNumber: 2,
    reason: "email is invalid",
  });

  const people = await pool.query(
    "SELECT count(*)::int AS n FROM imported_people WHERE created_from_job_id = $1",
    [job.id],
  );
  const outcome = await pool.query(
    "SELECT success, failure_reason FROM import_row_outcomes WHERE job_id = $1",
    [job.id],
  );
  const counts = await pool.query(
    "SELECT processed, success, failure FROM import_jobs WHERE id = $1",
    [job.id],
  );

  expect(people.rows[0].n).toBe(0);
  expect(outcome.rows[0]).toEqual({
    success: false,
    failure_reason: "email is invalid",
  });
  expect(counts.rows[0]).toEqual({ processed: 1, success: 0, failure: 1 });
});
