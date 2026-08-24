import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as upload } from "@/app/api/upload/route";
import { closePool, getPool } from "@/lib/db";
import { countJobs } from "@/lib/jobs";
import { migrate } from "@/lib/migrate";
import { insertOperator } from "@/lib/operators";
import { hashPassword } from "@/lib/password";
import { seedOperator } from "@/lib/seed";
import {
  encodeSession,
  SESSION_COOKIE_NAME,
} from "@/lib/session";
import {
  declaredBodyTooLarge,
  FILE_TOO_LARGE_ERROR,
  MAX_REQUEST_BYTES,
  MAX_UPLOAD_BYTES,
  readBodyCapped,
  validateUploadFile,
} from "@/lib/upload";
import { access } from "node:fs/promises";

const pool = getPool();
let uploadDir: string;
let previousUploadDir: string | undefined;

beforeAll(async () => {
  previousUploadDir = process.env.UPLOAD_DIR;
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "grady-api-uploads-"));
  process.env.UPLOAD_DIR = uploadDir;
  await migrate(pool);
  await seedOperator(pool);
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

async function sessionCookie(email?: string, password?: string): Promise<string> {
  const response = await login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: email ?? process.env.SEED_OPERATOR_EMAIL,
        password: password ?? process.env.SEED_OPERATOR_PASSWORD,
      }),
    }),
  );
  return `${SESSION_COOKIE_NAME}=${response.cookies.get(SESSION_COOKIE_NAME)?.value}`;
}

function csvFile(name: string, contents: string | BlobPart): File {
  return new File([contents], name, { type: "text/csv" });
}

async function postFile(file: File, cookie: string): Promise<Response> {
  const form = new FormData();
  form.append("file", file);
  return upload(
    new Request("http://localhost/api/upload", {
      method: "POST",
      headers: { cookie },
      body: form,
    }),
  );
}

test("declaredBodyTooLarge is true only above the request cap", () => {
  expect(declaredBodyTooLarge(null)).toBe(false);
  expect(declaredBodyTooLarge("")).toBe(false);
  expect(declaredBodyTooLarge(String(MAX_REQUEST_BYTES))).toBe(false);
  expect(declaredBodyTooLarge(String(MAX_REQUEST_BYTES + 1))).toBe(true);
  expect(declaredBodyTooLarge("not-a-number")).toBe(false);
});

test("readBodyCapped stops reading once the limit is exceeded", async () => {
  const chunkSize = 64 * 1024;
  let enqueued = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = new Uint8Array(chunkSize);
      enqueued += chunkSize;
      controller.enqueue(chunk);
    },
  });
  const request = new Request("http://localhost/api/upload", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  const result = await readBodyCapped(request, 256 * 1024);
  expect(result.ok).toBe(false);
  expect(enqueued).toBeLessThanOrEqual(256 * 1024 + chunkSize);
});

test("validateUploadFile rejects empty, oversize, and non-.csv names", () => {
  expect(validateUploadFile({ name: "users.csv", size: 0 })).toBe("File is empty");
  expect(validateUploadFile({ name: "users.csv", size: MAX_UPLOAD_BYTES + 1 })).toBe(
    "File is larger than 50 MB",
  );
  expect(validateUploadFile({ name: "data.CSV", size: 10 })).toBe(
    "Filename must end with .csv",
  );
  expect(validateUploadFile({ name: "report.txt", size: 10 })).toBe(
    "Filename must end with .csv",
  );
  expect(validateUploadFile({ name: "users.csv", size: MAX_UPLOAD_BYTES })).toBeNull();
});

test("authenticated upload stores a queued job and returns its id", async () => {
  const cookie = await sessionCookie();
  const originalName = `people-${Date.now()}.csv`;
  const response = await postFile(csvFile(originalName, "email,first_name,last_name\na,b,c\n"), cookie);
  const body = (await response.json()) as { id: string };

  expect(response.status).toBe(200);
  expect(body.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  const job = await pool.query(
    "SELECT original_filename, stored_path, status FROM import_jobs WHERE id = $1",
    [body.id],
  );
  expect(job.rows[0].status).toBe("queued");
  expect(job.rows[0].original_filename).toBe(originalName);
  expect(path.basename(job.rows[0].stored_path)).not.toBe(originalName);
  await access(job.rows[0].stored_path);
});

test("unauthenticated upload creates no job", async () => {
  const before = await countJobs(pool);
  const form = new FormData();
  form.append("file", csvFile("anon.csv", "email\n"));
  const response = await upload(
    new Request("http://localhost/api/upload", { method: "POST", body: form }),
  );
  expect(response.status).toBe(401);
  expect(await countJobs(pool)).toBe(before);
});

test("Content-Length over the request cap is rejected without creating a job", async () => {
  const cookie = await sessionCookie();
  const before = await countJobs(pool);
  const response = await upload(
    new Request("http://localhost/api/upload", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "multipart/form-data; boundary=----test",
        "content-length": String(MAX_REQUEST_BYTES + 1),
      },
      body: "------test--\r\n",
    }),
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: FILE_TOO_LARGE_ERROR });
  expect(await countJobs(pool)).toBe(before);
});

test("rejected files create no job", async () => {
  const cookie = await sessionCookie();
  const before = await countJobs(pool);

  const empty = await postFile(csvFile("empty.csv", ""), cookie);
  const csvCase = await postFile(csvFile("data.CSV", "x"), cookie);
  const txt = await postFile(new File(["x"], "report.txt"), cookie);
  const oversize = await postFile(
    csvFile("big.csv", new Uint8Array(MAX_UPLOAD_BYTES + 1).buffer),
    cookie,
  );

  expect(empty.status).toBe(400);
  expect(csvCase.status).toBe(400);
  expect(txt.status).toBe(400);
  expect(oversize.status).toBe(400);
  expect(await countJobs(pool)).toBe(before);
});

test("duplicate queued filename is rejected for the same operator only", async () => {
  const cookie = await sessionCookie();
  const filename = `dup-${Date.now()}.csv`;
  const first = await postFile(csvFile(filename, "a,b\n"), cookie);
  const second = await postFile(csvFile(filename, "a,b\n"), cookie);
  expect(first.status).toBe(200);
  expect(second.status).toBe(409);

  const other = await insertOperator(
    pool,
    `second-${Date.now()}@example.com`,
    await hashPassword("second-password"),
  );
  const otherCookie = `${SESSION_COOKIE_NAME}=${encodeSession({
    operatorId: other.id,
    email: other.email,
  })}`;
  const otherUpload = await postFile(csvFile(filename, "a,b\n"), otherCookie);
  expect(otherUpload.status).toBe(200);
});

test("unexpected CSV columns still create a queued job", async () => {
  const cookie = await sessionCookie();
  const response = await postFile(
    csvFile(`odd-${Date.now()}.csv`, "foo,bar,baz\n1,2,3\n"),
    cookie,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { id: string };
  const job = await pool.query("SELECT status FROM import_jobs WHERE id = $1", [
    body.id,
  ]);
  expect(job.rows[0].status).toBe("queued");
});

test("filename case is significant for queued duplicates", async () => {
  const cookie = await sessionCookie();
  const stamp = Date.now();
  const lower = await postFile(csvFile(`users-${stamp}.csv`, "a\n"), cookie);
  const upper = await postFile(csvFile(`Users-${stamp}.csv`, "a\n"), cookie);
  expect(lower.status).toBe(200);
  expect(upper.status).toBe(200);
});

test("successful upload does not create imported-user or per-row result tables", async () => {
  const cookie = await sessionCookie();
  const response = await postFile(
    csvFile(`schema-${Date.now()}.csv`, "email,first_name,last_name\n"),
    cookie,
  );
  expect(response.status).toBe(200);

  const tables = await pool.query<{ tablename: string }>(
    `SELECT tablename
     FROM pg_catalog.pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`,
  );
  expect(tables.rows.map((row) => row.tablename)).toEqual([
    "import_jobs",
    "operators",
  ]);
});
