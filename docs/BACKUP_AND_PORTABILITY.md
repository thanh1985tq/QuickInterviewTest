# Backup and portability

QuickInterviewTest does not synchronize SQLite and PostgreSQL. They are separate environments. Movement is an explicit, operator-reviewed export/import operation.

## JSON portability

- `GET /api/questions/export.json` exports all question identities, versions, tags, answer keys, and rubrics for an authorized administrator/interviewer.
- `POST /api/questions/import` accepts `{ "dryRun": true, "document": ... }`. Dry-run is the default and reports duplicate IDs, version conflicts, and invalid current versions without writing.
- `GET /api/templates/export.json` and `POST /api/templates/import` provide the equivalent template workflow. Import requires every referenced published question version to exist, so import the question bank first.
- Conflicted non-dry-run imports return `409` before a transaction writes anything. Imported content never overwrites existing questions, templates, attempts, answers, or results.
- Result exports are available as filtered CSV and JSON at `/api/results/export.csv` and `/api/results/export.json`.

Export documents contain server-only scoring information and must be protected as administrative data. Candidate manifests never use these export endpoints.

## SQLite backup

With the `local-sqlite` profile configured, run:

```text
npm run backup:sqlite
```

The command uses SQLite's online backup API and creates a timestamped file under `./backups`. Pass an explicit destination after `--` if required. It refuses in-memory or PostgreSQL profiles and refuses to overwrite an existing destination.

## PostgreSQL backup

Use the external PostgreSQL provider's managed backups when available. For a manual logical backup from a trusted workstation:

```text
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" --file quick-interview.dump
pg_restore --clean --if-exists --no-owner --no-acl --dbname "$RESTORE_DATABASE_URL" quick-interview.dump
```

Test restoration into a separate database before relying on a backup. Do not place database dumps on the Render filesystem; it is ephemeral. Restrict backup access because dumps contain identities, answers, results, and session/token hashes.
