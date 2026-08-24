import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { createPool } from "@/lib/db";

const migrationsDir = path.join(process.cwd(), "db", "migrations");

export async function migrate(pool: Pool = createPool()): Promise<void> {
  const names = (await readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of names) {
    const sql = await readFile(path.join(migrationsDir, name), "utf8");
    await pool.query(sql);
  }
}
