import { loadEnvConfig } from "@next/env";
import { createPool } from "../lib/db";
import { migrate } from "../lib/migrate";

loadEnvConfig(process.cwd());

async function main() {
  const pool = createPool();
  try {
    await migrate(pool);
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
