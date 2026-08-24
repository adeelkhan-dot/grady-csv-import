import { afterAll, expect, test } from "vitest";
import { createPool, getDatabaseUrl } from "@/lib/db";

const pool = createPool();

afterAll(async () => {
  await pool.end();
});

test("DATABASE_URL is set for tests", () => {
  expect(getDatabaseUrl()).toMatch(/^postgres(ql)?:\/\//);
});

test("connects to Postgres using DATABASE_URL", async () => {
  const result = await pool.query<{ ok: number }>("SELECT 1::int AS ok");
  expect(result.rows[0]?.ok).toBe(1);
});
