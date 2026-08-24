# CSV upload and import job

Status: **complete**

## Feature goal

An authenticated operator can upload one CSV file and receive a persisted import job whose file is stored for later background processing. The upload request must not parse or import rows.

## Context

This is Phase 1 of the roadmap in a greenfield Next.js + PostgreSQL product. The repository has no application code yet. Mission requires background processing of large CSVs; that worker, row-level partial import, status/progress UI, and in-app job notifications are later phases.

Exact CSV columns were deferred from the foundation to this spec. The documented schema is not enforced at upload time.

## User/business problem

Admin operators need a way to submit a bulk user CSV without waiting for row processing in the same request. They also need the upload surface restricted to the client’s operator team.

## Functional requirements

1. The product is a Next.js application with a PostgreSQL database. This phase stands up that application far enough to deliver login and CSV upload.
2. Operators authenticate with email and password. Sessions are stored in an HTTP-only cookie. Operator records live in PostgreSQL.
3. Operator accounts are created only by seed/configuration. There is no self-serve sign-up, invite flow, or password reset.
4. At least one operator can be seeded from configuration (for example environment variables or a seed script). There is no UI for creating or editing operators.
5. Unauthenticated visitors can reach only the login page. The upload UI and the upload API require a valid session. This phase has no job-read or status API.
6. Invalid login attempts return a generic invalid-credentials error. The UI must not reveal whether the email exists. This phase does not lock accounts after failed attempts.
7. A logged-in operator can log out. After logout, the upload API rejects the request until they sign in again.
8. The upload page shows the current operator’s identity (email is sufficient).
9. A logged-in operator can submit exactly one file per upload. The UI uses a standard file picker; drag-and-drop is not required.
10. The server rejects the upload, and must not create a job, when any of the following is true:
    - the file is empty
    - the original filename does not end with `.csv` (comparison is case-sensitive on the filename string as sent)
    - the file is larger than 50 MB
    - the operator already has a job in status `queued` whose `original_filename` equals the uploaded filename string exactly (case-sensitive, as sent by the browser)
11. On a valid upload, the server stores the file bytes on the local filesystem of the app host and inserts an import job row in PostgreSQL. The job status is `queued`.
12. The on-disk object name must not be the original filename. Store a unique path (for example derived from the job id) and keep the original filename as job metadata.
13. A job is created only if the file was stored. If file storage fails, no job row is committed and the operator sees a failure. If the database insert fails after a file write, the operator must not be told the upload succeeded; an orphan file must not be treated as a job.
14. After a successful upload, the operator remains on the upload page and sees a confirmation that includes the new job id.
15. Each successful upload creates a new job. Re-using an original filename is allowed only when this operator has no remaining `queued` job with that exact filename. In this phase jobs stay `queued`, so the same operator cannot upload that filename again until a later phase moves the existing job out of `queued`.
16. The documented CSV schema for later processing is `email`, `first_name`, `last_name`. Phase 1 must not parse CSV headers or row values and must not reject files for column mismatch.
17. The upload request must not process import rows, write imported user records, or start a worker.

## Relevant non-functional requirements

- **Security:** Passwords are stored with a standard slow hash (Argon2 or bcrypt). Session cookies are HTTP-only and not readable from client JavaScript. Upload and job APIs are session-gated.
- **Performance:** The upload HTTP request may receive the file bytes, persist them, and create the job. It must not parse or import tens of thousands of rows in that request. Maximum accepted file size is 50 MB.
- **Reliability:** Job existence and file existence must agree for a successful response: success means both a stored file and a committed `queued` job.
- **Not applicable:** Multi-tenant isolation, third-party integrations, and email delivery are out of product scope. Accessibility beyond a usable login and file input is not a requirement of this phase.

## Constraints

- Stack is TypeScript, Node.js, Next.js, PostgreSQL, and Tailwind CSS for the operator UI (`specs/tech-stack.md`). Visual restyling must not change acceptance criteria 1–12.
- Import work is asynchronous by architecture; this phase only creates the persisted job and stored file.
- File storage is local disk, not object storage and not PostgreSQL bytea.
- Single-tenant: one enterprise client. No broader admin portal (roles, billing, unrelated admin tools).
- Mission excludes email, Slack, and webhook notifications; this phase also excludes email password reset.

## Decisions

- Phase 1 stops at authenticated upload plus persisted `queued` job. Row processing, progress UI, and job notifications wait for later roadmap phases.
- Authentication is real email/password with PostgreSQL-backed operators and cookie sessions, included in this phase because upload must not be public.
- Accounts are seeded only. No self-serve registration, invites, or password recovery.
- Failed logins use generic errors and no lockout.
- CSV is stored as-is on local disk. No header or row inspection in this phase.
- Expected later-phase columns are `email`, `first_name`, `last_name`; enforcement is deferred to background processing.
- Upload limits: 50 MB, `.csv` suffix required, empty file rejected, one file per submit.
- Duplicate original filename is rejected only for the same operator while a job with that exact filename is still `queued`.
- Filename matching uses the exact original filename string from the browser (case-sensitive), not a normalized basename.
- Post-upload UX is confirmation on the same upload page, including job id. No job list or status page in this phase.
- Operator UI is styled with Tailwind CSS. Visual polish must not change acceptance criteria 1–12. No component library unless later approved.
- Disk object names are unique ids; original filename is metadata used for duplicate checks and display.

## Assumptions

- A conventional Next.js App Router layout is acceptable; no existing app conventions exist.
- Showing the operator email is enough identity on the upload page.
- Seed configuration will supply at least one email/password pair via environment or a seed script; exact seed credentials are operational, not product behavior.
- No extra password-complexity rules beyond a non-empty password set at seed time.
- Session lifetime may follow a common default (for example, expire after inactivity or after a small number of days) unless changed later.
- Concurrent duplicate uploads from the same operator are resolved by a database uniqueness rule, not only an application-layer check.
- HTTPS termination is a deployment concern, not an application feature of this phase.

## Edge cases

- Unauthenticated GET of the upload page redirects to login. Unauthenticated POST to upload/job APIs returns 401 (or equivalent) and creates no job.
- Filename `users.csv` vs `Users.csv` are different names and do not conflict.
- Two operators may both have a `queued` job named `users.csv`.
- The same operator may upload `users.csv` again only after their existing job with that name is no longer `queued` (not possible until a later phase changes status).
- A file named `data.CSV` is rejected because it does not end with `.csv`.
- A `.csv` file that is not actually comma-separated text is still accepted; content is not inspected.
- A 50 MB + 1 byte file is rejected. A file of exactly 50 MB is accepted if it is non-empty and otherwise valid.
- Disk full or unwritable storage directory: no job is committed; operator sees failure.
- Session expiry during an upload: treat as unauthenticated; no job.

## Explicit out-of-scope items

- Background worker and row processing (roadmap Phase 2)
- Partial import, per-row success/failure records, and imported user records (Phase 2)
- Import status/progress page (Phase 3)
- In-app completion/failure notifications (Phase 4)
- Validating CSV columns or row values
- Multi-file upload, drag-and-drop as a requirement, and object storage
- Self-serve sign-up, invites, password reset, SSO, and account lockout
- Operator management UI, roles, billing, and other admin-portal features
- Email, Slack, or webhook notifications
- Multi-tenant SaaS

## Acceptance criteria

1. A seeded operator can sign in with email and password and reach the upload page. A wrong password does not sign them in and does not disclose whether the email exists.
2. A visitor who is not logged in cannot upload a file or create a job, and cannot view the upload page except via redirect to login.
3. A logged-in operator can log out and is then treated as unauthenticated.
4. The upload page shows the signed-in operator’s email.
5. Submitting one valid non-empty `.csv` file ≤ 50 MB stores the file on local disk, creates a `queued` job owned by that operator, and shows the job id on the upload page.
6. Empty files, files over 50 MB, and files whose original name does not end with `.csv` are rejected with no job created.
7. A second upload by the same operator with the exact same original filename is rejected while the first job is `queued`.
8. A second operator can upload a file with the same original filename as another operator’s `queued` job.
9. Stored files are not named using the original filename as the unique on-disk key.
10. Upload success does not depend on parsing CSV headers or rows. A file with unexpected columns still creates a `queued` job if it passes the size/extension/empty/duplicate checks.
11. The upload path does not write imported user records or per-row results.
12. Automated tests cover login gating, upload rejection rules, successful job+file persistence, and the per-operator queued-filename uniqueness rule.
