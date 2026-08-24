# Tech Stack

## Language

TypeScript

## Framework

Next.js

## Runtime

Node.js

## Database

PostgreSQL

## Major architectural choices

- One Next.js application serves the operator UI and HTTP API.
- Import work is asynchronous: an upload creates a persisted job; a worker process processes rows after the request returns.
- Job state, progress, per-row results, and imported user records are stored in PostgreSQL.
- The status page reads persisted job state; it does not depend on the original upload request remaining open.
- Completion and failure notifications in v1 are in-app, tied to the job and status UI.

## Testing approach

Automated unit and integration tests. Tests must cover CSV ingest, row-level success and failure, and job state transitions, including mixed-success completion.

## Engineering constraints

- Imports of tens of thousands of rows must not be handled as a single synchronous upload request.
- Partial import is mandatory: a failed row must not roll back already-committed valid rows.
- Exact operator authentication is not chosen yet; it is not a stack constraint for this foundation.

## Established conventions

None yet. This is a greenfield repository with no existing application code or conventions.

## Provenance

- Discovered facts
  - No package manifest, framework, or database was present in the repository.
- Confirmed decisions
  - TypeScript, Node.js, Next.js, PostgreSQL.
  - Worker process plus job and row tables in PostgreSQL. No Redis, SQS, or third-party job platform unless chosen later.
  - Automated unit and integration tests as above.
- Assumptions
  - None.
