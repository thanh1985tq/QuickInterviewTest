# QuickInterviewTest

QuickInterviewTest is a lightweight system for quickly creating, delivering, and reviewing technical interviews. It starts with Automation Testing and Performance Testing domains, and administrators can add more domains without changing the application. Standard Web is the default delivery channel; a fixed Colab + Gradio runner is available as an experimental option for selected attempts.

The Express/TypeScript backend is the source of truth for questions, immutable test snapshots, attempts, deadlines, answers, scoring, and results. Local standalone development uses SQLite. Render deployments use external PostgreSQL and never rely on the Render filesystem for persistent data.

## Version 1 safety boundary

- Administrative login and role authorization are required for authoring, publishing, candidate management, and review. There is no public registration endpoint.
- Candidates receive unguessable, scoped, expiring links; session, candidate, runner, and Gradio secrets are stored only as hashes.
- Candidate code and scripts are collected as plain text. The system never executes submitted Python, shell, Selenium, Playwright, k6, JMeter, Locust, or other code.
- Published question/template versions and per-candidate snapshots are immutable.
- SQLite and PostgreSQL are separate environments. JSON import/export is explicit; there is no synchronization process.

## Local SQLite quick start

Requirements: Node.js 22 or newer and npm.

```text
npm install
copy .env.example .env
npm run migrate
```

Set a temporary bootstrap credential in the terminal, run the bootstrap, and then remove it:

```text
set BOOTSTRAP_ADMIN_EMAIL=admin@example.com
set BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-long-unique-password
set SEED_ADMIN_EMAIL=admin@example.com
npm run bootstrap-admin
npm run seed:question-bank
npm run dev
```

For the seed command, also set `SEED_ADMIN_EMAIL` to the bootstrapped administrator email. On PowerShell, use `$env:BOOTSTRAP_ADMIN_EMAIL='...'`, `$env:BOOTSTRAP_ADMIN_PASSWORD='...'`, and `$env:SEED_ADMIN_EMAIL='...'`. Open `http://localhost:3000/login`. The bootstrap user must change the temporary password before administrative APIs are available.

The default `.env.example` selects `local-sqlite` and writes only to the ignored `./data` directory. Use `local-postgres` plus `DATABASE_URL` to develop against PostgreSQL. Run `npm run migrate` after switching databases; no data is copied automatically.

## Main workflows

1. Bootstrap an admin, then provision `INTERVIEWER` and `REVIEWER` users through `/api/admin/users`.
2. Manage active interview disciplines through Domain Management. Archiving a domain prevents new content while preserving existing questions, templates, and results.
3. Load the optional 40-question starter library with `npm run seed:question-bank`, import a portable JSON question bank, use the optional AI Assistant, or create and publish questions through `/api/questions`.
4. Compose, preview, edit, and publish a template through `/api/templates`.
5. Create an independent Standard Web or Colab attempt through `/api/test-instances`. Candidate and runner tokens are disclosed only in the creation response.
6. Standard Web candidates use `/test/{candidateToken}`. Autosave and submission write directly to the configured database.
7. Review automatic/manual scores, comments, history, and exports through `/api/results`.
8. For Lab Mode, use the fixed notebook at `/lab/QuickInterviewTest.ipynb` and wait for deployment state `READY` before sharing the Gradio link.

Administrative mutations require the `X-CSRF-Token` returned by `/api/auth/login` or `/api/auth/session`. Candidate and runner APIs use their distinct bearer credentials.

The AI Assistant is optional. Configure an OpenAI-compatible chat-completions provider with `OPENAI_API_URL` or `OPEN_API_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL`; keep the key in local environment variables or Render secrets, never in source files.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the TypeScript development server with reload. |
| `npm run build && npm start` | Compile and start the production server. |
| `npm run migrate` | Apply portable SQLite/PostgreSQL migrations. |
| `npm run bootstrap-admin` | Create or rotate the bootstrap administrator from environment variables. |
| `npm run seed:question-bank` | Idempotently publish 20 Automation and 20 Performance Testing starter questions. |
| `npm run backup:sqlite` | Create an online, timestamped local SQLite backup. |
| `npm run retention` | Remove expired ephemeral records; optionally anonymize one candidate. |
| `npm run check` | Type-check, lint, run API/domain tests, and build. |
| `npm run test:e2e` | Run the Chromium admin-to-candidate workflow. |

## Verification

The automated suite covers authentication/roles/CSRF, rate limiting, portable schema constraints, publication immutability, template validation, scoped and expired candidate tokens, autosave/resume/idempotency, submission locking, objective/manual scoring, exports/import conflicts, runner-token reuse, Lab relaunch/recovery, heartbeat loss, security headers, and log redaction. PostgreSQL migration parity runs in CI with PostgreSQL 16.

```text
npm run check
npx playwright install chromium
npm run test:e2e
npm audit --audit-level=high
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md), [security model](docs/SECURITY.md)
- [Environment profiles](docs/ENVIRONMENT.md) and [delivery-mode matrix](docs/DELIVERY_MODES.md)
- [Starter question library](docs/QUESTION_LIBRARY.md), [Colab runner](docs/COLAB_RUNNER.md), [backup and portability](docs/BACKUP_AND_PORTABILITY.md), [data retention](docs/DATA_RETENTION.md)
- [Render operations](docs/OPERATIONS.md), [Neon-to-Render setup](docs/NEON_RENDER_SETUP.md), [security checklist](docs/SECURITY_CHECKLIST.md), and [pilot/release checklist](docs/PILOT_RELEASE.md)

See `render.yaml` for the Render Free web-service configuration. Production requires an external PostgreSQL `DATABASE_URL`, HTTPS `BASE_URL`, `APP_PROFILE=render-postgres`, and `NODE_ENV=production`. For Neon, also set direct `MIGRATION_DATABASE_URL`; the runtime `DATABASE_URL` should be pooled.
