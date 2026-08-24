# Roadmap

Phases are high-level and independently specifiable. Do not treat this file as a task list.

**Current next feature:** Background processing with partial success (Phase 2)

## Phase 1 — CSV upload and import job

- Goal: An operator can upload a CSV and create a persisted import job.
- Depends on: (none)
- Status: complete

## Phase 2 — Background processing with partial success

- Goal: A worker processes rows asynchronously. Valid rows persist, failed rows are recorded, and mixed success is allowed.
- Depends on: Phase 1
- Status: not started

## Phase 3 — Import status and progress

- Goal: A status page shows progress for an import job.
- Depends on: Phase 1, Phase 2
- Status: not started

## Phase 4 — Completion and failure notifications

- Goal: Operators are notified in-app when a job finishes or fails.
- Depends on: Phase 3
- Status: not started
