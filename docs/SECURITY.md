# Security model

## Authentication and authorization

- There is no public registration route. The first administrator is created or updated by `npm run bootstrap-admin` in a trusted terminal.
- Passwords use Node.js `scrypt` with a unique random salt and constant-time comparison. Hash parameters and format are versioned for future upgrades.
- The browser receives a random opaque session ID; only its SHA-256 hash is stored in `user_sessions`.
- Sessions expire, can be revoked by logout, and persist across application restarts because they live in SQLite locally or PostgreSQL in cloud environments.
- Admin mutations require a session-bound CSRF value in addition to the session cookie. Cookies are `HttpOnly`, `SameSite=Lax`, path-scoped, and `Secure` outside local/test use.
- Role policy is deny-by-default: `ADMIN` manages users; `ADMIN` and `INTERVIEWER` manage questions/templates/attempts; `ADMIN` and `REVIEWER` review and score results.
- Login attempts are rate limited by normalized account and network address. Responses do not disclose whether an account exists.

## Candidate and runner access

- Candidate tokens contain at least 256 bits of entropy, are scoped to one attempt, expire, and are stored only as SHA-256 hashes.
- Route token comparisons are performed through indexed hash lookup; APIs never accept an attempt ID as a substitute for a token.
- Runner exchange tokens are distinct from candidate tokens, single-use, short-lived, hashed, and limited to a `COLAB_GRADIO` attempt.
- Exchanged runner credentials are short-lived and deployment-specific. Relaunch rotates credentials and invalidates the prior deployment.
- Candidate-safe manifests omit answer keys, accepted choices, scoring rules, and reviewer rubrics.
- No candidate answer is executed. Code, shell, k6, JMeter, Locust, Selenium, Playwright, and Python submissions are plain text.

## Web and API controls

- Helmet supplies security headers and a restrictive Content Security Policy for application pages.
- Zod validates request parameters, bodies, and configuration. Unknown fields are rejected for security-sensitive commands.
- Knex parameterizes values; raw SQL is restricted to constant probes and migration definitions.
- JSON output is serialized by Express; browser code uses text nodes rather than HTML insertion for untrusted values.
- Request body limits are small and explicit. Version 1 has no file uploads.
- Separate rate limiters cover login, candidate token resolution, and runner token exchange.
- Server time controls availability and deadlines. Submitted/expired attempts reject all candidate mutations.
- Autosave and submission are idempotent so retries cannot duplicate domain actions.

## Logging and secrets

- Every request has a UUID request ID returned in `X-Request-Id`.
- Structured logs redact authorization/cookie headers and fields matching password, token, secret, answer, credential, cookie, and database URL.
- Audit records identify the actor, action, target, request ID, and non-sensitive summary.
- Logs must not contain passwords, session IDs, candidate/runner tokens, answers, Gradio credentials, or database connection strings.
- Secrets are provided only through environment variables and are not committed. `.env` and database files are ignored.

## Operational controls

- Cloud mode refuses SQLite and requires `DATABASE_URL` plus secure-cookie behavior behind Render's proxy.
- `/ready` verifies database connectivity without revealing connection details.
- Data-retention jobs may expire sessions and tokens and anonymize candidates according to the operator runbook.
- Dependency auditing is part of CI. Operators investigate high-severity production dependency findings before release.
- PostgreSQL backups are handled by the database provider or `pg_dump`; no cloud backup is written to the Render filesystem.

## Security reporting checklist

Before a release, run unit/integration/end-to-end tests, `npm audit --omit=dev`, verify HTTPS cookies, verify unauthorized and CSRF failures, inspect logs for redaction, exercise expired/reused tokens, confirm database persistence across a restart, and review `docs/OPERATIONS.md`.

