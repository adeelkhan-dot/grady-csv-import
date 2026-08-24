import { afterAll, beforeAll, expect, test } from "vitest";
import { createPool } from "@/lib/db";
import { migrate } from "@/lib/migrate";
import { findOperatorByEmail } from "@/lib/operators";
import { hashPassword, verifyPassword } from "@/lib/password";
import { seedOperator } from "@/lib/seed";

const pool = createPool();

beforeAll(async () => {
  await migrate(pool);
});

afterAll(async () => {
  await pool.end();
});

test("hashPassword does not store plaintext and verifyPassword succeeds", async () => {
  const password = "seed-password";
  const hash = await hashPassword(password);

  expect(hash).not.toBe(password);
  expect(hash.startsWith("$argon2")).toBe(true);
  expect(await verifyPassword(hash, password)).toBe(true);
  expect(await verifyPassword(hash, "wrong-password")).toBe(false);
});

test("seed creates an operator whose stored hash verifies and is not plaintext", async () => {
  const email = process.env.SEED_OPERATOR_EMAIL;
  const password = process.env.SEED_OPERATOR_PASSWORD;
  expect(email).toBeTruthy();
  expect(password).toBeTruthy();

  await seedOperator(pool);

  const operator = await findOperatorByEmail(pool, email!);
  expect(operator).not.toBeNull();
  expect(operator!.password_hash).not.toBe(password);
  expect(operator!.password_hash.startsWith("$argon2")).toBe(true);
  expect(await verifyPassword(operator!.password_hash, password!)).toBe(true);
});
