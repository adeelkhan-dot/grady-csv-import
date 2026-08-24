# Tech Stack

## Language

TypeScript

## Framework

Next.js

## Runtime

Node.js

## Database

PostgreSQL, run locally and in CI with Docker Compose and the official `postgres` image (pin a major version in compose). The Next.js app runs on the host (or CI Node) and connects via environment variables. Production may use managed PostgreSQL; that is a deploy choice, not a requirement to containerize the app.

## Major architectural choices

- One Next.js application serves the operator UI and HTTP API.
- Import work is asynchronous: an upload creates a persisted job; a worker process processes rows after the request returns.
- Job state, progress, per-row results, and imported user records are stored in PostgreSQL.
- Local and CI Postgres is a Compose service only. Do not put the Next.js app in Docker unless that is chosen later.
- Operators authenticate with email and password. Sessions use an HTTP-only cookie. Operator records live in PostgreSQL.
- The status page reads persisted job state; it does not depend on the original upload request remaining open.
- Completion and failure notifications in v1 are in-app, tied to the job and status UI.

## Testing approach

Automated unit and integration tests. Tests must cover CSV ingest, row-level success and failure, and job state transitions, including mixed-success completion.

## Engineering constraints

- Imports of tens of thousands of rows must not be handled as a single synchronous upload request.
- Partial import is mandatory: a failed row must not roll back already-committed valid rows.
- Operator authentication is email and password with HTTP-only cookie sessions. Passwords are stored with a standard slow hash (Argon2 or bcrypt). Upload APIs require a session.

## Established conventions

- Local/CI database: Docker Compose + official `postgres` image; app connection string from env (for example `DATABASE_URL`).
- Operator auth: email/password, HTTP-only session cookie, operators table in PostgreSQL.
- No other application conventions yet. This is otherwise a greenfield repository.

## Provenance

- Discovered facts
  - No package manifest, framework, or database was present in the repository.
- Confirmed decisions
  - TypeScript, Node.js, Next.js, PostgreSQL.
  - Worker process plus job and row tables in PostgreSQL. No Redis, SQS, or third-party job platform unless chosen later.
  - Local/CI Postgres via Docker Compose and the official `postgres` image. Next.js is not containerized for this.
  - Operator auth: email/password, HTTP-only cookie session, operators in PostgreSQL. No SSO in v1.
  - Automated unit and integration tests as above.
- Assumptions
  - None.
