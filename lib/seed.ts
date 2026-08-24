import type { Pool } from "pg";
import { findOperatorByEmail, insertOperator } from "@/lib/operators";
import { hashPassword } from "@/lib/password";

export function getSeedOperatorCredentials(): { email: string; password: string } {
  const email = process.env.SEED_OPERATOR_EMAIL;
  const password = process.env.SEED_OPERATOR_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "SEED_OPERATOR_EMAIL and SEED_OPERATOR_PASSWORD must be set",
    );
  }

  return { email, password };
}

export async function seedOperator(pool: Pool): Promise<{ email: string; created: boolean }> {
  const { email, password } = getSeedOperatorCredentials();
  const existing = await findOperatorByEmail(pool, email);
  if (existing) {
    return { email, created: false };
  }

  await insertOperator(pool, email, await hashPassword(password));
  return { email, created: true };
}
