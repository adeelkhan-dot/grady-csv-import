# Mission

## Purpose

Give an enterprise client’s admin team a way to bulk-import user data from CSV files without blocking on a synchronous upload.

## Target users

Admin operators on the client’s team. They upload files, watch jobs, and act on completion or failure.

Imported people are records in this product, not users of this product.

## Desired outcomes

- Operators can import CSV files with tens of thousands of rows.
- Each import runs in the background as a persisted job.
- Operators can see import progress on a status page.
- Operators are notified when a job finishes or fails.
- Partial import is supported: valid rows are saved, invalid rows are recorded, and mixed success is a normal terminal state.

## High-level scope

- In scope
  - CSV upload and persisted import jobs
  - Background processing of import rows
  - Writing imported user records owned by this product
  - Status and progress UI
  - In-app notification when a job finishes or fails
  - Row-level success and failure (partial import)
  - Operator sign-in with email and password (seeded accounts)
- Out of scope (only what the human confirmed)
  - A broader admin portal (roles, billing, unrelated admin tools)
  - Email, Slack, or webhook notifications
  - Integrating with an external identity or user store
  - Operator self-serve sign-up, invites, password reset, or SSO
  - Multi-tenant SaaS for multiple clients

## Important product context

This repository is a standalone bulk-import product: the import UI, backend, and jobs live here. The client’s wider admin portal is not this product.

Operator authentication is email and password with cookie sessions. Accounts are seeded/configured only.

Exact CSV columns and row-validation rules are specified in feature specs, not in this foundation. Phase 1 documents columns as `email`, `first_name`, `last_name` and defers enforcement to processing.

## Provenance

- Discovered facts
  - The repository contained only a title README and no product source, tests, or existing specs when this foundation was written.
- Confirmed decisions
  - Standalone bulk-import product in this repo (admin UI + backend/jobs).
  - Background processing for large CSVs; status page; notify on finish or fail; partial imports mandatory.
  - This app is the source of truth for imported user records.
  - Partial import means row-level commit with mixed success allowed.
  - v1 notifications are in-app.
  - Single-tenant: one enterprise client.
  - Operators sign in with email and password; accounts are seeded only (no self-serve sign-up, invites, password reset, or SSO).
- Assumptions
  - None. CSV row-validation rules remain in later feature specs.
