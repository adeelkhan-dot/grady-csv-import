import { NextResponse } from "next/server";
import { authenticateOperator, INVALID_CREDENTIALS } from "@/lib/auth";
import {
  encodeSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/session";

export async function POST(request: Request) {
  let email = "";
  let password = "";

  const contentType = request.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  if (isJson) {
    const body = (await request.json()) as { email?: string; password?: string };
    email = body.email ?? "";
    password = body.password ?? "";
  } else {
    const form = await request.formData();
    email = String(form.get("email") ?? "");
    password = String(form.get("password") ?? "");
  }

  const operator = await authenticateOperator(email, password);
  if (!operator) {
    if (isJson) {
      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  const response = isJson
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL("/upload", request.url), 303);
  response.cookies.set(
    SESSION_COOKIE_NAME,
    encodeSession({ operatorId: operator.id, email: operator.email }),
    sessionCookieOptions(),
  );
  return response;
}
