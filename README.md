# grady-csv-import

Standalone bulk-import product: operators upload CSV files and run persisted import jobs.

## Local development

The Next.js app runs on the host. PostgreSQL runs in Docker Compose.

Copy `.env.example` to `.env.local` and set `SEED_OPERATOR_PASSWORD` and `SESSION_SECRET`.
2. Start Postgres:

```bash
docker compose up -d --wait
```

`DATABASE_URL` (see `.env.example`) is the connection string for local development and automated tests. Tests load the same Compose defaults from `.env.test`.

3. Install dependencies, apply schema, and seed one operator:

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

4. Run tests (requires Compose Postgres to be up):

```bash
npm test
```
