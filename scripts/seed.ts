import { loadEnvConfig } from "@next/env";
import { createPool } from "../lib/db";
import { migrate } from "../lib/migrate";
import { seedOperator } from "../lib/seed";

loadEnvConfig(process.cwd());

async function main() {
  const pool = createPool();
  try {
    await migrate(pool);
    const result = await seedOperator(pool);
    console.log(
      result.created
        ? `Seeded operator ${result.email}`
        : `Operator ${result.email} already exists`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
