import { getPool } from "@/lib/db";
import { findOperatorByEmail, type Operator } from "@/lib/operators";
import { hashPassword, verifyPassword } from "@/lib/password";

export const INVALID_CREDENTIALS = "Invalid email or password";

let dummyHashPromise: Promise<string> | undefined;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword("not-a-real-operator-password");
  return dummyHashPromise;
}

export async function authenticateOperator(
  email: string,
  password: string,
): Promise<Operator | null> {
  const operator = await findOperatorByEmail(getPool(), email);
  const hash = operator?.password_hash ?? (await dummyHash());
  const matches = await verifyPassword(hash, password);
  if (!operator || !matches) {
    return null;
  }
  return operator;
}
