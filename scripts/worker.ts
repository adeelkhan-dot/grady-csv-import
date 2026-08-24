import { loadEnvConfig } from "@next/env";
import { createPool } from "../lib/db";
import { runWorkerOnce, workerPollIntervalMs } from "../lib/worker";

loadEnvConfig(process.cwd());

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const pool = createPool();
  const pollMs = workerPollIntervalMs();
  let stopping = false;

  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log(`Worker polling every ${pollMs}ms`);

  try {
    while (!stopping) {
      try {
        const job = await runWorkerOnce(pool);
        if (job) {
          console.log(`Processed job ${job.id}`);
        } else if (!stopping) {
          await sleep(pollMs);
        }
      } catch (error) {
        console.error(error);
        if (!stopping) {
          await sleep(pollMs);
        }
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
