# Plan — CSV upload and import job

Status: **complete**

## Implementation approach

Stand up a greenfield Next.js (TypeScript) application with PostgreSQL. Deliver operator session auth first, then local-disk CSV storage and a `queued` import job. Keep the upload HTTP handler limited to validation, file persist, and job insert — no CSV parsing and no worker.

Because this repository has no application code, Group 1 creates the runnable app and a Docker Compose Postgres service. Later groups add schema and product behavior on that foundation. Prefer conventional Next.js App Router locations once the app exists; do not introduce Redis, SQS, or object storage. Do not containerize the Next.js app in this phase.

## Dependencies

- Project foundation: `specs/mission.md`, `specs/tech-stack.md`, `specs/roadmap.md`
- This feature has no prior feature spec. Phase 2+ must not be implemented here.
- Runtime: Node.js on the host; PostgreSQL via Docker Compose for local development and tests (`specs/tech-stack.md`)
- No existing modules; files below are to be created

## Task groups

### Group 1 — Application and database foundation

- Relevant files/modules: package manifest and Next.js app entrypoints (to be created); `compose.yaml` (or `docker-compose.yml`) with the official `postgres` image (to be created); PostgreSQL connection config via env (to be created)
- Depends on: nothing in-repo
- Verification target: `docker compose up` (or equivalent) starts Postgres; the Next.js app boots on the host and tests can connect using the documented env vars.

1. [x] Create the TypeScript Next.js application and install the minimum dependencies needed for the App Router, API routes, and PostgreSQL access.
2. [x] Add a Compose file that runs only Postgres (official `postgres` image, pinned major version), with a named volume for data. Do not add an app container.
3. [x] Add PostgreSQL connection configuration via environment variables (for example `DATABASE_URL`) for local development and automated tests against that Compose service.
4. [x] Add a baseline test runner so later groups can attach unit and integration tests.

### Group 2 — Operator records and seed

- Relevant files/modules: operator persistence (to be created); password hashing helper (to be created); seed script or equivalent (to be created)
- Depends on: Group 1
- Verification target: Seeding creates at least one operator whose password verifies with the chosen slow hash; passwords are not stored in plaintext.

1. [x] Add an operators table (email unique, password hash, timestamps as needed).
2. [x] Hash passwords with Argon2 or bcrypt; never persist plaintext passwords.
3. [x] Seed at least one operator from configuration/environment. Provide no operator-create UI.

### Group 3 — Session authentication

- Relevant files/modules: login and logout routes/pages (to be created); session cookie handling (to be created); auth guards for upload routes (to be created)
- Depends on: Group 2
- Verification target: Seeded credentials establish a session; bad credentials fail generically; protected routes reject unauthenticated requests.

1. [x] Implement email/password login that sets an HTTP-only session cookie on success.
2. [x] Use a generic invalid-credentials error; do not reveal whether the email exists. Do not add lockout.
3. [x] Implement logout that clears the session.
4. [x] Allow unauthenticated access only to the login page. Require a session for the upload UI and upload API (redirect vs 401 as appropriate for page vs API). Do not add a job-read or status API.

### Group 4 — Import job persistence and local file storage

- Relevant files/modules: import job persistence (to be created); local storage directory and path helper (to be created)
- Depends on: Groups 1–2 (operator id as job owner)
- Verification target: A job row can be inserted with status `queued` and a stored_path; a uniqueness rule prevents two `queued` jobs for the same operator and exact original filename.

1. [x] Add an import jobs table: id, operator id, original filename, stored path, size, status, created time.
2. [x] Default/accept only `queued` as the status written in this phase.
3. [x] Enforce uniqueness of `(operator_id, original_filename)` among rows with status `queued` (partial unique index or equivalent).
4. [x] Store file bytes under a unique on-disk name (not the original filename). Record that path on the job.
5. [x] Ensure a failed file write does not commit a job, and a failed job insert is not reported as success.

### Group 5 — Upload API

- Relevant files/modules: upload HTTP handler (to be created); validation for size, empty file, `.csv` suffix, duplicate queued filename
- Depends on: Groups 3–4
- Verification target: Valid authenticated upload returns a new job id and persists file + `queued` job; each rejection rule creates no job.

1. [x] Accept exactly one file per request from a logged-in operator.
2. [x] Reject empty files, files larger than 50 MB, and original filenames that do not end with `.csv` (exact string, case-sensitive).
3. [x] Reject when the operator already has a `queued` job with that exact original filename; other operators are unaffected.
4. [x] Persist the file, insert the `queued` job, and return the job id. Do not parse CSV content.

### Group 6 — Operator UI

- Relevant files/modules: login page (to be created); upload page (to be created)
- Depends on: Groups 3 and 5
- Verification target: Manual or integration coverage of login, logout, identity display, successful confirmation with job id, and visible rejection of invalid uploads.

1. [x] Build a login page (email, password) that is the only public page.
2. [x] Build an upload page with a file picker, current operator email, logout control, and post-success confirmation that includes the job id.
3. [x] Stay on the upload page after success. Do not add a job list or progress view.

### Group 7 — Automated tests for this phase

- Relevant files/modules: unit and integration tests (to be created)
- Depends on: Groups 2–5 (UI checks in Group 6 as far as the chosen test stack allows)
- Verification target: Commands documented in `validation.md` pass; Phase 2 mixed-success/row-processing tests are not part of this merge bar.

1. [x] Test login success, generic login failure, session gating, and logout.
2. [x] Test successful upload: file on disk, `queued` job, response/UI includes job id, on-disk name is not the original filename.
3. [x] Test rejections: unauthenticated, empty, oversize, missing `.csv` suffix, duplicate queued filename for the same operator.
4. [x] Test that a second operator (created in the test if needed) may use the same original filename.
5. [x] Test that unexpected CSV columns still produce a `queued` job (no parser/validator invoked).
6. [x] Test that a successful upload does not write imported-user or per-row result records (those tables/modules must not be part of this phase).

### Group 8 — Tailwind CSS and operator UI restyle

- Relevant files/modules: `app/globals.css`; `postcss.config.mjs`; `app/layout.tsx`; `app/login/page.tsx`; `app/upload/page.tsx`; `app/upload/upload-form.tsx`
- Depends on: Group 6
- Verification target: Login and upload pages use Tailwind utilities; login, logout, upload, validation, and job-creation behavior is unchanged. Phase 2–4 work is not in scope.

1. [x] Add Tailwind CSS using the current Next.js App Router + Tailwind v4 PostCSS integration. Do not add a component library.
2. [x] Replace inline layout styles and restyle the existing login and upload operator pages (readable layout, clear primary actions, visible error/success). Do not add screens, drag-and-drop, a job list, or a status page.
