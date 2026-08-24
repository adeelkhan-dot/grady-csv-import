# Background processing with partial success

Status: **planned**

## Feature goal

A separate worker process picks up `queued` import jobs, processes CSV rows asynchronously, persists valid people, records every processed row’s outcome, and finishes in a terminal status that allows mixed success. The upload HTTP request still must not parse or import rows.

## Context

This is Phase 2 of the roadmap. Phase 1 delivers authenticated CSV upload, local-disk storage, and a persisted `queued` job (`specs/2026-08-24-csv-upload-and-import-job/`). Mission requires row-level partial import: valid rows are saved, invalid rows are recorded, and mixed success is a normal terminal state. Phase 3 will show status/progress; this phase only writes the data that page will read. Phase 4 notifications are out of scope.

Job infrastructure is a Node worker plus PostgreSQL job/row/people tables. No BullMQ, Redis, SQS, or other job platform (`specs/tech-stack.md`).

## User/business problem

Operators upload files with tens of thousands of rows and cannot wait for import in the upload request. They need the product to import good rows, keep a durable record of bad rows, and continue when some rows fail. A failed row must not undo people already imported.

## Functional requirements

1. A long-running worker process, started separately from the Next.js app (for example `npm run worker`), polls PostgreSQL for `queued` import jobs and processes them after the upload request has returned.
2. The worker must not be started by the upload HTTP handler. Upload behavior from Phase 1 stays: validate size/extension/emptiness/duplicate queued filename, store bytes, insert `queued` job, return the job id.
3. At most one job is processed at a time. Before claiming a `queued` job, any job still in `processing` is treated as a crashed worker (see requirement 20).
4. When a job is claimed, its status becomes `processing`. Counts start at zero unless this is crash recovery (crash recovery does not resume the job).
5. The worker reads the CSV from the job’s existing `stored_path` on local disk. It does not re-upload or copy the file.
6. CSV dialect: UTF-8, comma-separated, RFC 4180 quoting. Strip a leading UTF-8 BOM if present. Invalid encoding or an unreadable file fails the job: status `failed`, job-level error set, no people inserted, no row outcomes.
7. A header row is required. Required header names are exactly `email`, `first_name`, and `last_name` (case-sensitive, not trimmed). Column order may vary. Extra unknown columns are ignored.
8. If any required header is missing, or any required header name appears more than once, the job fails immediately: status `failed`, job-level error set, no people inserted, no row outcomes.
9. Fully blank lines (empty or whitespace-only, with no CSV fields) are skipped. They are not row outcomes and they do not increment processed, success, or failure counts. They still occupy file line numbers.
10. A line that cannot be parsed as CSV (for example unbalanced quotes) is a failed row. Processing continues with later lines.
11. Each data row is validated after trimming all three mapped fields:
    - `email`, `first_name`, and `last_name` are all required and non-blank after trim.
    - `email` is then lowercased for comparison and storage.
    - Names keep their original casing after trim.
    - Email format: non-empty local part, `@`, non-empty domain that contains a `.` (example: `pat@example.com` passes; `pat@localhost` and `@x.com` fail). No RFC/DNS lookup.
12. Email uniquely identifies an imported person globally (not per operator, not per job). A unique constraint on stored email is the source of truth.
13. Duplicate email (already imported, or already committed earlier in this file) fails that row. Do not update `first_name`, `last_name`, or `created_from_job_id` on the existing person. First committed occurrence wins.
14. A successful row inserts one imported person: `email` (lowercase, unique), `first_name`, `last_name`, `created_at`, and `created_from_job_id` set to this job’s id. There is no people directory UI.
15. Each valid person insert and its success outcome are committed so that a later failed row cannot roll back already-imported people (row-level commit / partial import).
16. Persist an outcome for every processed data row (not skipped blank lines): 1-based file line number (header is line 1), success or failure, and a reason on failure. Successful outcomes have no failure reason.
17. Persist running counts on the job as rows are processed: `processed`, `success`, `failure`. `processed` equals `success + failure`. Skipped blank lines are not included.
18. When the worker finishes a job normally (file fully read):
    - `completed` if `success >= 1` and `failure = 0`
    - `completed_with_errors` if `success >= 1` and `failure >= 1`
    - `failed` if `success = 0` (header-only, only blank lines, all data rows invalid, unreadable file, or bad headers)
    Set a job-level error message when status is `failed` for these cases. `completed` and `completed_with_errors` have a null job-level error.
19. Allowed statuses written by this phase: `queued` (unchanged from upload), `processing`, `completed`, `completed_with_errors`, `failed`.
20. If the worker process dies mid-job, a later worker run does not resume. It marks leftover `processing` jobs `failed` with a job-level error (worker interrupted). Already-committed people and row outcomes stay. Remaining unread rows get no outcomes. This `failed` status applies even if `success > 0`. Retry is a new upload of remaining (or full) data.
21. The stored CSV file remains on disk after any terminal status. This phase adds no download UI.
22. Duplicate original filename is still rejected only while this operator has a job with that exact name in status `queued`. A job in `processing` or a terminal status does not block a new upload of that filename.
23. No new operator UI, job-read HTTP API, status/progress page, in-app notifications, or people list in this phase. The upload page still shows a job id and does not show progress.
24. Document how to run the worker locally (README or equivalent) so a queued job can be processed without guessing the command.

## Relevant non-functional requirements

- **Performance:** Tens of thousands of rows are processed in the worker, not in the upload request. The worker may take as long as needed; it must not hold the upload HTTP request open.
- **Reliability:** Partial import is mandatory. Worker crash must not delete committed people. Job status, counts, per-row outcomes, and people must be durable in PostgreSQL.
- **Security:** No new public HTTP endpoints. The worker uses the same database credentials as the app (`DATABASE_URL`). Upload and existing auth remain session-gated. Imported people are application data, not operator accounts.
- **Not applicable:** Multi-tenant isolation, email/Slack/webhooks, third-party job queues, and accessibility of a status UI (there is no new UI).

## Constraints

- Stack remains TypeScript, Node.js, Next.js, PostgreSQL, Tailwind for existing UI (`specs/tech-stack.md`).
- Worker process plus job/row/people tables in PostgreSQL. No Redis, BullMQ, SQS, or object storage.
- Local file storage from Phase 1 is unchanged.
- Single-tenant; this product is the source of truth for imported people.
- Phase 3 status page and Phase 4 notifications must not be implemented here.

## Decisions

- Postgres-backed polling worker, not BullMQ/Redis/SQS.
- Three normal terminals: `completed`, `completed_with_errors`, `failed`. Interrupted `processing` jobs also become `failed` even if some rows succeeded.
- Required CSV columns: `email`, `first_name`, `last_name`. Extra columns ignored. Header names exact and case-sensitive, not trimmed. Duplicate required headers fail the job.
- UTF-8 comma CSV with RFC 4180 quoting and optional BOM strip.
- Trim fields; store and match email lowercase; names keep post-trim casing.
- Simple email shape: `local@domain` with a dot in the domain; not a full RFC validator.
- Skip fully blank lines; malformed lines fail and processing continues.
- Email uniqueness is global. Duplicates fail the row; no upsert.
- Persist every processed row outcome (success and failure) plus running counts on the job, so Phase 3 can read them without a UI in this phase.
- Row numbers are 1-based file line numbers (header is line 1).
- Job-level error message on `failed` jobs only.
- Keep the CSV on disk after terminal status.
- One job at a time; crash does not resume; operator retries by uploading again.
- Filename uniqueness stays Phase 1 (`queued` only).
- People records include `created_from_job_id` of the job that first inserted them; it is never updated.
- No job-read HTTP API in this phase; tests may inspect PostgreSQL directly.

## Assumptions

- A conventional `npm run worker` (or equivalent) long-running loop is acceptable; poll interval is an implementation choice as long as queued jobs are picked up without a manual per-job CLI.
- Claiming a job uses a database update so two worker processes cannot process the same job; leftover `processing` rows are always failed before a new claim.
- `,,` or other rows that parse as empty fields are data rows that fail validation, not skipped blank lines.
- Failure reasons are short operator-readable strings (missing field, invalid email, duplicate email, unparseable line). Exact wording may follow existing upload-error tone.
- Existing Phase 1 tests that asserted imported-person / per-row tables do not exist must be updated: those tables will exist; upload must still not write to them.
- HTTPS, worker hosting, and process supervision in production are deployment concerns.

## Edge cases

- Header-only file, or header plus only blank lines: `failed`, counts stay zero (or processed remains 0), job-level error set, no people.
- File whose headers are not the three required names: `failed` at header check; the Phase 1 upload still accepted it as `queued`.
- Extra columns besides the three required names: ignored; valid rows still import.
- `data.CSV` never reaches the worker (Phase 1 rejects it).
- `Email` as a header does not match `email`; job `failed`.
- ` email ` (leading/trailing spaces in the header cell) does not match `email`; job `failed`.
- `pat@example.com` then later `Pat@Example.com` in the same file: first inserts; second fails as duplicate.
- Two operators import the same email: the second row fails; the person is not updated.
- Same operator re-uploads the same filename after the job leaves `queued`: upload succeeds; rows whose emails already exist fail as duplicates; new emails insert.
- Same operator uploads the same filename while the first job is `processing`: upload succeeds (not `queued` uniqueness); the second job waits until the worker is free; overlapping emails fail as duplicates.
- Worker crash after 100 successful rows of 1000: job `failed`, 100 people remain, 100 success outcomes, no outcomes for unread lines.
- Unbalanced quotes on one line: that line fails; later lines still process.
- Invalid UTF-8 file: job `failed`, no people.
- Empty file cannot be queued (Phase 1).
- Unique-constraint violation on email is treated as a failed row, not a crashed job.

## Explicit out-of-scope items

- Import status/progress page (roadmap Phase 3)
- Job-read HTTP API for the operator UI
- In-app completion/failure notifications (Phase 4)
- Download or delete of stored CSVs from the UI
- People directory / search UI
- Updating existing people (upsert)
- Resuming an interrupted job from the next unread row
- BullMQ, Redis, SQS, or any third-party job platform
- Changing Phase 1 upload validation, parsing CSV at upload time, or object storage
- Self-serve operator accounts, SSO, multi-tenant SaaS, email/Slack/webhooks

## Acceptance criteria

1. A `queued` job is left `queued` until a worker process, started separately from the upload request, claims it. The upload handler does not parse CSV rows or insert people.
2. After a worker processes a file with all valid unique rows and the required headers, the job is `completed`, people exist for each data row, each data row has a success outcome, and `failure = 0`.
3. A file with some valid rows and some invalid rows finishes `completed_with_errors`. Valid rows are persisted as people. Invalid rows have failure outcomes with reasons. Already-imported valid rows remain.
4. A file with required headers but zero successful data rows finishes `failed` with a job-level error and no people inserted (unless a prior job already inserted people unrelated to this file).
5. Missing, extra-required-duplicate, or wrong header names fail the job with no people and no row outcomes.
6. Duplicate emails (in-file or already imported) fail those rows and do not update the existing person. The first committed person keeps its names and `created_from_job_id`.
7. Fully blank lines are skipped (no outcome, not counted). Unparseable lines fail and processing continues.
8. Emails are stored lowercase; `first_name` / `last_name` keep post-trim casing. `pat@localhost` fails format validation.
9. Running counts on the job equal the recorded outcomes (`processed = success + failure`).
10. A leftover `processing` job is marked `failed` on the next worker run; committed people stay; the job is not resumed.
11. The stored CSV still exists after terminal status. No status page, job-read API, or notification UI is added.
12. Duplicate original filename is still rejected only for `queued` jobs of that operator.
13. Automated tests cover job state transitions, row-level success and failure, mixed-success completion, duplicate email, header failure, crash-to-failed, and that upload still does not import rows.
