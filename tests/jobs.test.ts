import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { closePool, getPool } from "@/lib/db";
import { countJobs, createQueuedJob } from "@/lib/jobs";
import { migrate } from "@/lib/migrate";
import { findOperatorByEmail, insertOperator } from "@/lib/operators";
import { hashPassword } from "@/lib/password";
import { seedOperator } from "@/lib/seed";
import { storedPathForJob } from "@/lib/storage";

const pool = getPool();
let operatorId: string;
let uploadDir: string;
let previousUploadDir: string | undefined;

beforeAll(async () => {
  previousUploadDir = process.env.UPLOAD_DIR;
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "grady-uploads-"));
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

test("createQueuedJob stores a queued job and a unique on-disk path", async () => {
  const originalFilename = `users-${Date.now()}.csv`;
  const bytes = Buffer.from("email,first_name,last_name\n");
  const job = await createQueuedJob(pool, {
    operatorId,
    originalFilename,
    bytes,
  });

  expect(job.status).toBe("queued");
  expect(job.original_filename).toBe(originalFilename);
  expect(path.basename(job.stored_path)).not.toBe(originalFilename);
  expect(job.stored_path).toBe(storedPathForJob(job.id));
  expect(Number(job.size_bytes)).toBe(bytes.length);
  await access(job.stored_path);
});

test("queued filename uniqueness is per operator", async () => {
  const filename = `shared-${Date.now()}.csv`;
  const bytes = Buffer.from("a,b\n");
  await createQueuedJob(pool, {
    operatorId,
    originalFilename: filename,
    bytes,
  });

  await expect(
    createQueuedJob(pool, {
      operatorId,
      originalFilename: filename,
      bytes,
    }),
  ).rejects.toThrow();

  const other = await insertOperator(
    pool,
    `other-${Date.now()}@example.com`,
    await hashPassword("other-password"),
  );
  const second = await createQueuedJob(pool, {
    operatorId: other.id,
    originalFilename: filename,
    bytes,
  });
  expect(second.status).toBe("queued");
  expect(path.basename(second.stored_path)).not.toBe(filename);
});

test("a failed file write does not commit a job", async () => {
  const before = await countJobs(pool);
  const blocker = path.join(uploadDir, "not-a-dir");
  await writeFile(blocker, "x");
  process.env.UPLOAD_DIR = blocker;

  await expect(
    createQueuedJob(pool, {
      operatorId,
      originalFilename: `fail-${Date.now()}.csv`,
      bytes: Buffer.from("x"),
    }),
  ).rejects.toThrow();

  expect(await countJobs(pool)).toBe(before);
  process.env.UPLOAD_DIR = uploadDir;
});
