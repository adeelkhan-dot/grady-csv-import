import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { createQueuedJob } from "@/lib/jobs";
import { readSessionFromRequest } from "@/lib/session";
import {
  declaredBodyTooLarge,
  FILE_TOO_LARGE_ERROR,
  isUniqueViolation,
  MAX_REQUEST_BYTES,
  readBodyCapped,
  validateUploadFile,
} from "@/lib/upload";

export const runtime = "nodejs";

async function parseUploadForm(request: Request): Promise<FormData | Response> {
  if (declaredBodyTooLarge(request.headers.get("content-length"))) {
    if (request.body) {
      await request.body.cancel().catch(() => undefined);
    }
    return NextResponse.json({ error: FILE_TOO_LARGE_ERROR }, { status: 400 });
  }

  const capped = await readBodyCapped(request, MAX_REQUEST_BYTES);
  if (!capped.ok) {
    return NextResponse.json({ error: FILE_TOO_LARGE_ERROR }, { status: 400 });
  }

  const contentType = request.headers.get("content-type");
  if (!contentType) {
    return NextResponse.json({ error: "Upload failed" }, { status: 400 });
  }

  try {
    return await new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: Buffer.from(capped.body),
    }).formData();
  } catch {
    return NextResponse.json({ error: "Upload failed" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const session = readSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    const parsed = await parseUploadForm(request);
    if (parsed instanceof Response) {
      return parsed;
    }
    form = parsed;
  } catch {
    return NextResponse.json({ error: "Upload failed" }, { status: 400 });
  }

  const files = form.getAll("file").filter((value): value is File => value instanceof File);
  if (files.length !== 1) {
    return NextResponse.json({ error: "Upload exactly one file" }, { status: 400 });
  }

  const file = files[0];
  const bytes = Buffer.from(await file.arrayBuffer());
  const validationError = validateUploadFile({ name: file.name, size: bytes.length });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const job = await createQueuedJob(getPool(), {
      operatorId: session.operatorId,
      originalFilename: file.name,
      bytes,
    });
    return NextResponse.json({ id: job.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "A queued job with this filename already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
