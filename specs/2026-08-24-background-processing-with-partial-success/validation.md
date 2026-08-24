# Validation — Background processing with partial success

Status: **complete**

Automated coverage for this phase is in `tests/processing.test.ts`, `tests/worker.test.ts`, `tests/job-claim.test.ts`, `tests/row-commit.test.ts`, `tests/schema.test.ts`, `tests/csv.test.ts`, and Phase 1 regressions in `tests/upload.test.ts`. Command: `npm test` (Vitest, Compose Postgres). Manual checks below remain for a human sign-off.

## Acceptance checks

Trace each check to `requirements.md` acceptance criteria (AC).

| Check | AC | Passes when |
| --- | --- | --- |
| Worker, not upload, processes rows | 1 | Upload creates `queued` job + file only; people/outcomes appear only after the worker runs |
| All-valid file completes | 2 | Status `completed`; one person per data row; all data-row outcomes success; `failure = 0` |
| Mixed success is terminal | 3 | Status `completed_with_errors`; valid people persisted; failed rows have reasons; successes not rolled back |
| Zero successes fails the job | 4 | Status `failed`; job-level error present; no new people from this job |
| Header problems fail the job | 5 | Missing, wrong, or duplicated required headers → `failed`; no people; no row outcomes |
| Duplicate email fails the row | 6 | Existing person unchanged (names and `created_from_job_id`); duplicate has a failure outcome |
| Blank vs malformed lines | 7 | Blank lines omitted from counts/outcomes; unparseable line is a failure; later rows still run |
| Normalization and email shape | 8 | Stored email is lowercase; names keep post-trim case; `pat@localhost` fails |
| Counts match outcomes | 9 | Job `processed = success + failure` and those totals match outcome rows |
| Crash does not resume | 10 | Leftover `processing` becomes `failed` with job-level error; committed people remain |
| No Phase 3/4 surface | 11 | CSV still on disk; no status page, job-read API, or notification UI |
| Queued filename rule unchanged | 12 | Same operator + same original filename rejected only while a job is `queued` |
| Automated coverage exists | 13 | Tests listed below run and pass (`npm test`) |

## Automated tests

Command: `npm test` (Vitest). Requires Compose Postgres as in Phase 1.

Required coverage (implemented):

- Worker/orchestrator claims `queued` → `processing` → a terminal status
- Upload path still does not parse CSV or insert people/outcomes
- All-valid rows: `completed`, people inserted, success outcomes, counts
- Mixed valid/invalid rows: `completed_with_errors`; partial people remain
- All-invalid data rows or header-only: `failed`, job-level error, no people from that job
- Missing required header, `Email` ≠ `email`, duplicated `email` header: `failed`, no outcomes
- Extra unknown columns ignored when required headers are present
- In-file duplicate email (including different casing): first inserts, later fails, no update
- Already-imported email from an earlier job: fail row, no update
- Blank line skipped (not counted); malformed line failed; processing continues
- Line numbers are 1-based file lines (header is 1)
- Email stored lowercase; `pat@localhost` invalid; `pat@example.com` valid when names present
- Unique constraint / duplicate treated as row failure, not worker crash
- Leftover `processing` job marked `failed` and not resumed; people kept
- Stored file still exists after terminal status
- Phase 1 duplicate queued filename still 409 for the same operator while `queued`
- Same original filename allowed once the job is not `queued` (for example after `completed` or `failed`)

Not required for this merge bar (later phases):

- Status/progress page
- Job-read HTTP API
- In-app job completion notifications
- CSV download UI
- People directory UI
- Job resume after crash
- BullMQ / Redis / SQS

## Manual verification

Run against local Postgres, a seeded operator, the Next.js app, and `npm run worker`.

1. Sign in and upload a small CSV with headers `email,first_name,last_name` and two valid unique rows. Confirm the upload page still shows a job id and the job is `queued` until the worker starts.
2. Start `npm run worker`. Confirm the job becomes `completed`, two people exist, and the file is still on disk.
3. Upload a file with one valid row and one invalid email. Confirm `completed_with_errors`, one person, one failure outcome with a reason.
4. Upload a file missing `last_name` in the header. Confirm `failed`, job-level error, no people from that job.
5. Re-upload a file that includes an already imported email. Confirm the duplicate row fails and the original person is unchanged.
6. Confirm a second upload of the same original filename is rejected while `queued`, and allowed after the job is terminal.
7. Confirm there is no new status page, job JSON API, notification UI, or people list.
8. Confirm login, logout, and Phase 1 rejection rules (empty, oversize, not `.csv`) still hold.

Optional crash check: mark or simulate a job left in `processing` after some inserts; start the worker; confirm it becomes `failed` and people remain.

## Failure scenarios

| Scenario | Expected |
| --- | --- |
| Missing/wrong/duplicate required headers | Job `failed`; job-level error; no people; no row outcomes |
| Invalid encoding / unreadable file | Job `failed`; job-level error; no people |
| Blank names or blank email after trim | Row failure; processing continues |
| Email without a dot in the domain (`pat@localhost`) | Row failure; processing continues |
| Duplicate email | Row failure; existing person not updated |
| Unparseable CSV line | Row failure; later lines still processed |
| Zero successful data rows | Job `failed`; job-level error |
| Worker dies while `processing` | Next worker run sets `failed` (even if `success > 0`); no resume |
| Two worker processes | Must not process the same job twice; leftover `processing` is failed before a new claim |
| Upload while a job is `processing` with the same original filename | Allowed (uniqueness is `queued` only); second job waits its turn |

## Regression checks

- Phase 1 login, logout, session gating, and upload validation still pass.
- Upload still does not inspect CSV content; unexpected columns still create a `queued` job.
- On-disk object name is still not the original filename.
- Queued-filename uniqueness remains per operator and `queued` only.
- Operator UI still has no job list, progress view, or notifications.
- Do not treat the absence of Phase 3–4 UI as a regression.

The Phase 1 test that required imported-person / per-row **tables not to exist** was updated: those tables exist after this phase; the regression is that **upload must not insert into them**.

## Integration checks

- Next.js app + worker + PostgreSQL: a file uploaded through the API is processed by the worker against the same database and disk `stored_path`.
- Local filesystem: worker reads the Phase 1 stored file; it is still present after terminal status.
- No Redis, BullMQ, SQS, object storage, or external identity integration checks.

No email, Slack, or webhook integration is in scope; do not add checks for them.
