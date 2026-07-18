# Architecture

## Purpose and scope

QuickInterviewTest is a single-tenant interview assessment application for Automation Testing and Performance Testing. Version 1 supports a reliable Standard Web candidate experience and an optional, experimental Colab + Gradio renderer. The Node.js application is the only authority for identities, tests, attempts, answers, deadlines, scoring, and results.

Version 1 deliberately does not execute candidate-provided code or test scripts. Code answers are stored and reviewed as plain text. It also excludes public administrator registration, automatic email, proctoring, AI scoring, multi-tenant billing, high-availability Colab hosting, and database synchronization.

## Runtime components

```text
Admin browser ─────────────┐
                          │ HTTPS + session cookie + CSRF
Candidate browser ────────┼────────► Express / TypeScript application
                          │                │
Fixed Colab runner ───────┘                ├── PostgreSQL (Render/cloud)
        manifest, answers, heartbeat       └── SQLite (local standalone)
```

- **Express application:** serves the admin and candidate pages, exposes JSON APIs, validates all commands, applies authorization, and owns all domain behavior.
- **Web frontend:** static HTML, CSS, and browser JavaScript served by Express. Standard Web is the default delivery mode.
- **Persistence layer:** a Knex-based repository boundary supports SQLite and PostgreSQL with equivalent migrations and transactional behavior. A process uses exactly one configured database.
- **Fixed Colab runner:** a versioned notebook starts one versioned Python runner for one attempt. It renders a candidate-safe manifest and saves answers through the Node.js API. It does not contain business rules or answer keys.

## System boundaries and trust

The browser, candidate link, Colab VM, Gradio process, and all client clocks are untrusted. The server determines session validity, role permissions, token scope, availability, deadlines, attempt state, version immutability, and score. Correct answers and rubrics are returned only to authorized reviewers.

PostgreSQL is mandatory in the `render-postgres` profile. The Render filesystem is ephemeral and is never used for application data, sessions, answers, or backups. SQLite is allowed only for local standalone and test profiles. Local and cloud databases are independent; data moves only through explicit import/export workflows.

## Main request flows

### Administrative flow

1. An administrator is created with the offline bootstrap command; there is no registration endpoint.
2. Login verifies a memory-hard password hash and creates an opaque, database-backed session.
3. Administrative mutations require a valid session, role permission, and session-bound CSRF token.
4. Question/template publication creates immutable versions.
5. Creating an attempt snapshots the selected published question versions and issues a scoped, expiring candidate token.

### Standard Web flow

1. The candidate opens `/test/{token}`.
2. The server hashes the token, resolves only its attempt, and checks availability/state.
3. Starting fixes the server-authoritative deadline. Refreshing never moves it.
4. Idempotent autosave stores answers in the configured database.
5. Idempotent submission locks answers and triggers objective scoring.

### Colab + Gradio flow

1. An interviewer creates a `COLAB_GRADIO` attempt and a distinct, single-use runner token.
2. The fixed runner exchanges it for a short-lived credential and downloads a candidate-safe manifest.
3. The runner starts authenticated Gradio, registers its URL and candidate-specific credentials, and sends heartbeats.
4. Gradio forwards answer saves and submission to Node.js. Saved state survives Colab loss.
5. A relaunch invalidates old deployment credentials. A missing heartbeat marks the deployment offline.

## Technical conventions

- TypeScript uses strict mode; HTTP inputs are parsed with Zod.
- Identifiers are UUIDs and timestamps are ISO 8601 UTC values in APIs.
- Database timestamps are written from the application for cross-database consistency.
- Errors use a stable JSON envelope with a request ID; logs are structured JSON with sensitive fields redacted.
- Mutations run in transactions where multiple records must change together.
- Status values are checked in domain services and database constraints where portable.
- APIs are namespaced under `/api`; administrative APIs require sessions, candidate APIs require candidate tokens, and runner APIs require runner credentials.

## Deployment topology

The Render web service binds to `0.0.0.0:$PORT`, trusts one reverse-proxy hop, uses HTTPS-aware secure cookies, and connects to an external PostgreSQL database through `DATABASE_URL`. Migrations are an explicit release command. `/health` reports process liveness; `/ready` performs a database probe. A redeploy can discard the application filesystem without losing state.

