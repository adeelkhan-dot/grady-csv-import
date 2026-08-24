import type { Pool, PoolClient } from "pg";

type Queryable = Pool | PoolClient;

export type ImportedPerson = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  created_at: Date;
  created_from_job_id: string;
};

export async function insertImportedPerson(
  db: Queryable,
  input: {
    email: string;
    first_name: string;
    last_name: string;
    created_from_job_id: string;
  },
): Promise<ImportedPerson> {
  const result = await db.query<ImportedPerson>(
    `INSERT INTO imported_people (
       email, first_name, last_name, created_from_job_id
     )
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, first_name, last_name, created_at, created_from_job_id`,
    [input.email, input.first_name, input.last_name, input.created_from_job_id],
  );
  return result.rows[0];
}
