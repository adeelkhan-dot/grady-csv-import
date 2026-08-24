# Validation — CSV upload and import job

Status: **planned**

## Acceptance checks

Trace each check to `requirements.md` acceptance criteria (AC).

| Check | AC | Passes when |
| --- | --- | --- |
| Seeded operator can sign in | 1 | Valid email/password establishes a session and the upload page is reachable |
| Invalid password is generic | 1 | Sign-in fails; response/UI does not indicate whether the email exists |
| Unauthenticated users cannot upload | 2 | Upload page redirects to login; upload API creates no job and returns 401 (or equivalent) |
| Logout ends the session | 3 | After logout, upload is rejected until login |
| Upload page shows operator email | 4 | Signed-in identity is visible on the upload page |
| Valid CSV creates queued job + stored file | 5 | File exists on local disk; job exists with status `queued` and that operator; UI shows job id |
| Empty / oversize / non-`.csv` rejected | 6 | No job row; no success confirmation |
| Duplicate queued filename rejected per operator | 7 | Second upload with the exact same original filename fails while the first job is `queued` |
| Filename uniqueness is not global | 8 | A different operator can queue the same original filename |
| On-disk name is not the original filename | 9 | Stored path/basename differs from the original filename |
| Columns are not validated | 10 | A `.csv` whose headers are not `email,first_name,last_name` still creates a `queued` job |
| No imported users or per-row results | 11 | Success path does not insert imported-user or per-row result records |
| Automated coverage exists | 12 | Tests listed below run and pass |

## Automated tests

Use the project’s unit and integration test runner once Group 1 adds it. Name the exact command in the implementation PR if it differs from a conventional `npm test` (or equivalent).

Required coverage:

- Operator password is hashed; seed can authenticate
- Login success; login failure with generic error
- Session required for upload API; unauthenticated POST creates no job
- Logout invalidates the session
- Valid upload: file written, job `queued`, job id returned, on-disk name is not the original filename
- Successful upload does not create imported-user or per-row result records
- Reject empty file
- Reject file larger than 50 MB
- Reject original filename not ending in `.csv` (include a `data.CSV` case)
- Reject exact original filename duplicate while that operator’s job is `queued`
- Allow the same original filename for a different operator
- Allow a file with headers other than `email,first_name,last_name` (proves no schema enforcement)
- Failed storage does not leave a committed job (if this can be simulated in tests)

Not required for this merge bar (later phases):

- Worker/row processing
- Partial import / mixed-success completion
- Per-row failure recording
- Status/progress page
- In-app job completion notifications

Tech-stack language about “row-level success and failure” and “mixed-success completion” applies starting in Phase 2, not this phase.

## Manual verification

Run against a local app with PostgreSQL and a seeded operator.

1. Open the app while logged out: only login is reachable.
2. Sign in with seeded credentials; confirm the upload page shows that operator’s email.
3. Sign in with a wrong password; confirm a generic error and no session.
4. Upload a small valid `.csv`; confirm the page stays on upload, shows a job id, and a matching `queued` row exists.
5. Confirm the file is on disk under a unique name, with the original name stored on the job.
6. Upload the same original filename again as the same operator; confirm rejection.
7. Log out; confirm upload is blocked.
8. If a second seeded operator exists, log in as them and upload the same original filename; confirm it succeeds.
9. Confirm rejected fixtures do not create jobs: empty file, `> 50 MB` file, `report.txt`, `data.CSV`.
10. Log out from the upload page using the logout control.

## Failure scenarios

| Scenario | Expected |
| --- | --- |
| Wrong password | Generic invalid credentials; no session |
| Unknown email | Same generic invalid credentials; no enumeration |
| Unauthenticated upload | No job; 401 or redirect |
| Empty file | No job; operator-visible error |
| File > 50 MB | No job; operator-visible error |
| Filename does not end with `.csv` | No job; operator-visible error |
| Same operator, same original filename, existing `queued` job | No second job; operator-visible error |
| Disk/storage failure | No committed job; operator-visible error; success is not shown |
| Session expired mid-upload | Treated as unauthenticated; no job |
| Database insert fails after file write | Operator is not told the upload succeeded; orphan file is not a job |

## Regression checks

No prior product behavior exists. After this phase, confirm the README/title-only repo still has no accidental worker, status page, or notification UI.

Do not treat Phase 2–4 gaps as regressions.

## Integration checks

- Next.js app + PostgreSQL: login and upload succeed against a real database in local/dev or CI.
- Local filesystem: a successful upload produces a readable file at the job’s stored path.
- Session cookie is HTTP-only (inspect response headers in a test or manual check).

No external identity provider, email service, or object-storage integration is in scope; do not add integration checks for them.
