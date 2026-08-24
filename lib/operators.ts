import type { Pool } from "pg";

export type Operator = {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
};

export async function findOperatorByEmail(
  pool: Pool,
  email: string,
): Promise<Operator | null> {
  const result = await pool.query<Operator>(
    "SELECT id, email, password_hash, created_at FROM operators WHERE email = $1",
    [email],
  );
  return result.rows[0] ?? null;
}

export async function insertOperator(
  pool: Pool,
  email: string,
  passwordHash: string,
): Promise<Operator> {
  const result = await pool.query<Operator>(
    `INSERT INTO operators (email, password_hash)
     VALUES ($1, $2)
     RETURNING id, email, password_hash, created_at`,
    [email, passwordHash],
  );
  return result.rows[0];
}
