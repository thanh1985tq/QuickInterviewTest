# Render and production operations

## Deployment architecture

Deploy one Render Free Node web service from `render.yaml` and connect it to an external managed PostgreSQL database. Do not add a Render disk and do not configure `SQLITE_PATH` in cloud mode. Users, sessions, questions, snapshots, attempts, answers, deployments, scores, and audit records live in PostgreSQL.

The service binds to `0.0.0.0:$PORT`, trusts one Render proxy hop, sets secure session cookies, exposes process liveness at `/health`, database readiness at `/ready`, and a cold-start page at `/status`.

## First deployment

1. Provision an external PostgreSQL database with TLS, backups, and an application-specific user/database.
2. Create the Render service from `render.yaml`.
3. Set `DATABASE_URL` as a secret, `BASE_URL` to the final `https://…onrender.com` URL, `APP_PROFILE=render-postgres`, and `NODE_ENV=production`. Review all variables in `docs/ENVIRONMENT.md`.
4. Deploy. The build compiles the application and applies migrations; startup does not use SQLite or write persistent application state to disk.
5. From a trusted workstation with temporary access to the production `DATABASE_URL`, run `npm run bootstrap-admin` with the bootstrap email/password variables. Remove the password variable immediately.
6. Open `/login`, change the bootstrap password, and provision named users with least-privilege roles.
7. Verify `/health`, `/ready`, HTTPS, the `Secure`/`HttpOnly`/`SameSite=Lax` session cookie, login/logout, and the admin audit trail.

Never print or paste `DATABASE_URL`, session cookies, candidate tokens, runner tokens, or answers into deployment logs or tickets.

## Before sending an interview link

- Open `/status` and wait for readiness after a Render cold start.
- Sign in and confirm the intended published template/version, candidate, availability window, and duration.
- For Standard Web, open the private link in a separate browser and confirm the welcome screen before sending it securely.
- For Lab Mode, launch the fixed notebook, wait for the latest generation to report `READY`, then send the Gradio URL and its separate credentials. Do not send an `OFFLINE`/`STARTING` deployment.

## Migration and release procedure

1. Take or confirm a recent provider backup.
2. Run CI, including PostgreSQL and Chromium jobs, and review `npm audit --audit-level=high`.
3. Apply migrations exactly once through the Render build command. Migrations are transactional where the database supports it and recorded in PostgreSQL.
4. Warm `/status`, run an admin smoke test, and run a disposable Standard Web attempt.
5. Check logs for errors and confirm a redeploy preserved the session/content/attempt data in PostgreSQL.

Schema changes should be backward-compatible with the immediately previous application release. Never use SQLite migration files or database dumps on Render's filesystem.

## Rollback

For an application regression, redeploy the previous known-good Git revision. Keep the current, backward-compatible schema; do not automatically roll back migrations containing production data. If a schema restoration is unavoidable, stop interview creation, take another backup, restore into a separate database, validate counts and critical workflows, then switch `DATABASE_URL` during a controlled maintenance window.

After rollback, verify admin login, active attempt resume, autosave, submission, scoring, and Lab connectivity. Rotate any credentials exposed during incident handling.

## Backup and recovery

Use provider-managed PostgreSQL backups and the procedure in `docs/BACKUP_AND_PORTABILITY.md`. Quarterly, restore into an isolated database and run readiness plus a result-integrity sample. A Render redeploy or cold start must not change row counts because no persistent state lives on its filesystem.

## Incident checks

- **`/health` down:** inspect build/start logs and the configured port/host.
- **`/health` up, `/ready` down:** check external PostgreSQL reachability, TLS, connection limits, and `DATABASE_URL` without logging it.
- **Login blocked:** wait for the configured window or inspect hashed `login_attempts`; do not disable throttling globally.
- **Attempt appears expired:** compare server UTC, availability, and stored deadline. Client clocks cannot extend it.
- **Lab `OFFLINE`:** create a new runner token and generation. Saved answers remain in PostgreSQL.
- **Suspected token exposure:** cancel/recreate the attempt or rotate the runner generation; revoke administrative sessions by rotating the user password.
