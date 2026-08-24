import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export function getUploadDir(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads");
}

export function storedPathForJob(jobId: string): string {
  return path.join(/* turbopackIgnore: true */ getUploadDir(), jobId);
}

export async function writeJobFile(jobId: string, bytes: Buffer): Promise<string> {
  const storedPath = storedPathForJob(jobId);
  await mkdir(path.dirname(storedPath), { recursive: true });
  await writeFile(storedPath, bytes, { flag: "wx" });
  return storedPath;
}

export async function removeJobFile(storedPath: string): Promise<void> {
  await unlink(storedPath).catch(() => undefined);
}
