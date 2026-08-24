import { Pool } from "pg";

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

export function createPool(): Pool {
  return new Pool({ connectionString: getDatabaseUrl() });
}

let sharedPool: Pool | undefined;

export function getPool(): Pool {
  sharedPool ??= createPool();
  return sharedPool;
}

export async function closePool(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = undefined;
  }
}
