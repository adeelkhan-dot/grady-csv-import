import { afterAll, beforeAll, expect, test } from "vitest";
import { POST as upload } from "@/app/api/upload/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { INVALID_CREDENTIALS } from "@/lib/auth";
import { closePool } from "@/lib/db";
import { migrate } from "@/lib/migrate";
import { seedOperator } from "@/lib/seed";
import {
  decodeSession,
  encodeSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/session";
import { proxy } from "@/proxy";
import { getPool } from "@/lib/db";
import { NextRequest } from "next/server";

beforeAll(async () => {
  await migrate(getPool());
  await seedOperator(getPool());
});

afterAll(async () => {
  await closePool();
});

test("session cookie options are HTTP-only", () => {
  expect(sessionCookieOptions().httpOnly).toBe(true);
});

test("encodeSession round-trips a valid payload", () => {
  const token = encodeSession({
    operatorId: "op-1",
    email: "operator@example.com",
  });
  const session = decodeSession(token);
  expect(session?.operatorId).toBe("op-1");
  expect(session?.email).toBe("operator@example.com");
  expect(decodeSession("tampered")).toBeNull();
});

test("login succeeds with seeded credentials and sets an HTTP-only session cookie", async () => {
  const response = await login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: process.env.SEED_OPERATOR_EMAIL,
        password: process.env.SEED_OPERATOR_PASSWORD,
      }),
    }),
  );

  expect(response.status).toBe(200);
  const cookie = response.cookies.get(SESSION_COOKIE_NAME);
  expect(cookie?.value).toBeTruthy();
  expect(cookie?.httpOnly).toBe(true);
  expect(decodeSession(cookie?.value)?.email).toBe(process.env.SEED_OPERATOR_EMAIL);
});

test("login failure is generic for wrong password and unknown email", async () => {
  const wrongPassword = await login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: process.env.SEED_OPERATOR_EMAIL,
        password: "not-the-password",
      }),
    }),
  );
  const unknownEmail = await login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "missing@example.com",
        password: "any-password",
      }),
    }),
  );

  expect(wrongPassword.status).toBe(401);
  expect(unknownEmail.status).toBe(401);
  expect(await wrongPassword.json()).toEqual({ error: INVALID_CREDENTIALS });
  expect(await unknownEmail.json()).toEqual({ error: INVALID_CREDENTIALS });
  expect(wrongPassword.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
});

test("logout clears the session cookie", async () => {
  const response = await logout(
    new Request("http://localhost/api/auth/logout", { method: "POST" }),
  );
  expect(response.status).toBe(200);
  const cookie = response.cookies.get(SESSION_COOKIE_NAME);
  expect(cookie?.value).toBe("");
  expect(cookie?.maxAge).toBe(0);
});

test("logout form redirect returns to login", async () => {
  const response = await logout(
    new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "",
    }),
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("http://localhost/login");
});

test("unauthenticated upload page redirects to login", async () => {
  const response = proxy(new NextRequest("http://localhost/upload"));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("http://localhost/login");
});

test("unauthenticated upload API returns 401", async () => {
  const form = new FormData();
  form.append("file", new File(["email\n"], "users.csv", { type: "text/csv" }));
  const response = await upload(
    new Request("http://localhost/api/upload", { method: "POST", body: form }),
  );
  expect(response.status).toBe(401);
});

test("after logout an upload without a session cookie is rejected", async () => {
  const loginResponse = await login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: process.env.SEED_OPERATOR_EMAIL,
        password: process.env.SEED_OPERATOR_PASSWORD,
      }),
    }),
  );
  expect(loginResponse.status).toBe(200);
  await logout(new Request("http://localhost/api/auth/logout", { method: "POST" }));

  const form = new FormData();
  form.append("file", new File(["email\n"], "after-logout.csv", { type: "text/csv" }));
  const response = await upload(
    new Request("http://localhost/api/upload", { method: "POST", body: form }),
  );
  expect(response.status).toBe(401);
});
