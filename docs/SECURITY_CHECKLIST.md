# Release security checklist

## Identity and access

- [ ] No public registration route exists; the bootstrap command is run in a trusted environment.
- [ ] Bootstrap password was changed and removed from environment configuration.
- [ ] Admin, interviewer, and reviewer permissions were exercised with deny cases.
- [ ] Sessions persist in PostgreSQL, expire, revoke on logout/password rotation, and use opaque hashed IDs.
- [ ] Production cookie is `Secure`, `HttpOnly`, and `SameSite=Lax`; Express trusts only the Render proxy hop.
- [ ] Administrative mutations reject missing/incorrect CSRF values.
- [ ] Login throttle returns generic errors and blocks repeated account/network failures.

## Candidate and runner boundary

- [ ] Candidate/runner tokens contain strong random entropy, are scoped, expiring, and hash-only at rest.
- [ ] A candidate cannot access another attempt or save against another snapshot question.
- [ ] Submitted/expired/cancelled attempts reject answer changes; duplicate saves/submits are idempotent.
- [ ] Candidate and runner manifests contain no answer keys or scoring rubrics.
- [ ] Runner exchange token is single-use; relaunch closes prior credentials; only `READY` links are distributable.
- [ ] Candidate code and all text are never executed.

## Application and operations

- [ ] Helmet headers/CSP, request-size limits, Zod validation, parameterized queries, and output encoding remain active.
- [ ] `/ready` includes a database probe and `/status` handles Render cold starts.
- [ ] Logs contain request IDs but no authorization/cookie headers, passwords, tokens, answers, credentials, or database URLs.
- [ ] Administrative changes, score overrides, comments, and password changes appear in the audit trail.
- [ ] `npm run check`, PostgreSQL CI, `npm run test:e2e`, Python compile, and `npm audit --audit-level=high` pass.
- [ ] External PostgreSQL backup/restore was tested; no persistent data or backups use the Render filesystem.
- [ ] Retention/anonymization policy and incident contacts are documented for the operator.
