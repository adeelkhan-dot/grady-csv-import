export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Multipart envelope (boundaries and part headers) on top of the file bytes. */
export const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
export const FILE_TOO_LARGE_ERROR = "File is larger than 50 MB";

export function validateUploadFile(file: { name: string; size: number }): string | null {
  if (file.size === 0) {
    return "File is empty";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return FILE_TOO_LARGE_ERROR;
  }
  if (!file.name.endsWith(".csv")) {
    return "Filename must end with .csv";
  }
  return null;
}

export function declaredBodyTooLarge(contentLengthHeader: string | null): boolean {
  if (contentLengthHeader === null || contentLengthHeader === "") {
    return false;
  }
  const declared = Number(contentLengthHeader);
  return Number.isFinite(declared) && declared > MAX_REQUEST_BYTES;
}

export async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; body: Uint8Array } | { ok: false }> {
  const stream = request.body;
  if (!stream) {
    return { ok: true, body: new Uint8Array() };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new Error("Failed to read upload body");
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
