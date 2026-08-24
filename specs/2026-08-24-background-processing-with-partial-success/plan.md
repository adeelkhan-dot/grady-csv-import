# Plan — Background processing with partial success

Status: **planned**

## Implementation approach

Keep the Next.js upload path unchanged except that jobs will leave `queued` when a **separate Node worker process** claims them. Add PostgreSQL schema for imported people, per-row outcomes, and job processing fields (status, counts, job-level error). Implement CSV parse/validate and row-level commit in library modules the worker calls. Poll `import_jobs` in PostgreSQL; do not add Redis, BullMQ, SQS, or new HTTP APIs.

Process one job at a time. On each worker loop, fail leftover `processing` jobs (crash), then claim one `queued` job. Read the file from the existing `stored_path`. Commit each successful person plus its outcome independently so later failures cannot roll back earlier inserts.

Prefer extending known modules (`lib/jobs.ts`, `lib/storage.ts`, `db/migrations/`) and adding focused new modules for CSV, people, row outcomes, and the worker entrypoint. Do not add a status page or job-read route.

## Dependencies

- Project foundation: `specs/mission.md`, `specs/tech-stack.md`, `specs/roadmap.md`
- Phase 1 complete: `specs/2026-08-24-csv-upload-and-import-job/` (upload, `queued` jobs, local disk, operator sessions)
- Runtime: Node.js on the host; PostgreSQL via Docker Compose; worker uses `DATABASE_URL` like the app
- No new product UI; Tailwind changes are not required

## Task groups

### Group 1 — Schema for processing, people, and row outcomes

- Relevant files/modules: `db/migrations/` (new migration after `002_import_jobs.sql`); `lib/jobs.ts`; `lib/migrate.ts` (existing runner)
- Depends on: Phase 1 schema
- Verification target: Migration applies on Compose Postgres. `import_jobs` accepts `processing`, `completed`, `completed_with_errors`, and `failed`. People and row-outcome tables exist with email uniqueness. Upload still inserts only `queued` jobs.

1. [ ] Extend `import_jobs` with processing fields: running `processed` / `success` / `failure` counts (default 0) and a nullable job-level error message. Keep existing `queued` default for new uploads.
2. [ ] Add an imported-people table: unique email, first_name, last_name, created_at, created_from_job_id (FK to `import_jobs`).
3. [ ] Add a per-row outcome table: job id, 1-based line number, success/failure, nullable failure reason. Uniqueness of `(job_id, line_number)`.
4. [ ] Preserve the Phase 1 partial unique index on `(operator_id, original_filename)` where `status = 'queued'` only.

### Group 2 — CSV parse and row validation

- Relevant files/modules: new parse/validate module under `lib/`; unit tests under `tests/`
- Depends on: Group 1 not required for pure unit tests
- Verification target: Unit tests for dialect, headers, blank lines, malformed lines, trim/lowercase, and email shape without touching the database.

1. [ ] Parse UTF-8 comma CSV with RFC 4180 quoting; strip a leading BOM; treat invalid encoding as a file-level failure.
2. [ ] Require exact header names `email`, `first_name`, `last_name` (any order, no header trim). Fail the file if one is missing or duplicated. Ignore extra columns.
3. [ ] Skip fully blank lines. Treat unparseable lines as row failures (caller continues).
4. [ ] Validate data rows: trim three fields; require non-blank; lowercase email; email must be `local@domain` with a `.` in the domain.

### Group 3 — People inserts and row outcomes (row-level commit)

- Relevant files/modules: new people/outcomes helpers under `lib/`; `lib/jobs.ts` or a processing module that updates counts
- Depends on: Groups 1–2
- Verification target: Inserting a valid row persists a person and a success outcome and increments counts. A duplicate email persists a failure outcome, does not update the person, and leaves prior people in place.

1. [ ] Insert a person with lowercase email, trimmed names, and `created_from_job_id`; rely on a unique constraint for duplicates.
2. [ ] Write a row outcome for every processed data row (line number, success or failure, reason on failure).
3. [ ] Update job counts so `processed = success + failure` after each processed row (or in the same transaction as that row).
4. [ ] Do not wrap the whole file in one transaction that would roll back successful people.

### Group 4 — Job claim, terminals, and crash recovery

- Relevant files/modules: `lib/jobs.ts` and/or a processing orchestrator under `lib/`
- Depends on: Groups 1 and 3
- Verification target: State transitions match `requirements.md`. A leftover `processing` job becomes `failed` with a job-level error and is not resumed.

1. [ ] Fail all leftover `processing` jobs (job-level error: worker interrupted) before claiming work, including when `success > 0`.
2. [ ] Claim one `queued` job at a time (`queued` → `processing`). Do not start another job while one is `processing`.
3. [ ] On normal finish, set `completed` / `completed_with_errors` / `failed` from counts as specified; set job-level error only on `failed`.
4. [ ] On header/file-level failure, set `failed` with a job-level error, counts at 0, no people, no row outcomes.

### Group 5 — Worker process

- Relevant files/modules: worker entry (for example `scripts/worker.ts`); `package.json` script; `lib/storage.ts` (read existing `stored_path`); README local-dev section
- Depends on: Groups 2–4
- Verification target: With the app and Postgres up, `npm run worker` (or the documented command) picks up a `queued` job from a completed Phase 1 upload and writes people, outcomes, counts, and a terminal status. The upload route is unchanged in responsibility.

1. [ ] Add a long-running worker that polls Postgres, recovers crashed `processing` jobs, then processes one claimed job by reading `stored_path`.
2. [ ] Do not invoke the worker from `app/api/upload/route.ts`.
3. [ ] Leave the CSV on disk after terminal status.
4. [ ] Document the worker command next to existing migrate/seed/dev instructions in the README.

### Group 6 — Tests and Phase 1 regression updates

- Relevant files/modules: `tests/` (new processing tests; update `tests/upload.test.ts` if it still asserts people/outcome tables do not exist)
- Depends on: Groups 1–5
- Verification target: `npm test` covers the checks in `validation.md`. Phase 2 mixed-success tests are in the merge bar. No status-page or notification tests are required.

1. [ ] Test all-success → `completed` with people + success outcomes.
2. [ ] Test mixed rows → `completed_with_errors`; valid people remain; failed rows have reasons.
3. [ ] Test zero successes (bad rows or header-only) → `failed` with job-level error.
4. [ ] Test missing/wrong/duplicate required headers → `failed`, no people, no outcomes.
5. [ ] Test in-file and already-imported duplicate emails; no update to the existing person.
6. [ ] Test blank-line skip vs malformed-line failure; line numbers are file line numbers.
7. [ ] Test leftover `processing` → `failed` without resume.
8. [ ] Test upload still creates `queued` jobs without inserting people or outcomes; update the Phase 1 “tables must not exist” assertion.
9. [ ] Test queued-filename uniqueness is unchanged (`queued` only).
