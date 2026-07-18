# Environment configuration

Configuration is parsed once on startup. Invalid or contradictory values fail fast without printing secrets.

## Profiles

| Profile | Database | Cookies | Intended use |
| --- | --- | --- | --- |
| `local-sqlite` | `SQLITE_PATH` | HTTP permitted | Default standalone development |
| `local-postgres` | `DATABASE_URL` | HTTP permitted | Local PostgreSQL development |
| `test` | temporary `SQLITE_PATH`, or `TEST_DATABASE_URL` | HTTP permitted | Automated tests |
| `render-postgres` | `DATABASE_URL` required; separate migration URL recommended | HTTPS/secure required | Render web service |

`render-postgres` rejects a SQLite configuration. SQLite files must not be placed on the Render filesystem. Profiles never synchronize with one another.

## Variables

| Name | Required/default | Meaning |
| --- | --- | --- |
| `APP_PROFILE` | `local-sqlite` | One of the profiles above. |
| `NODE_ENV` | `development` | `development`, `test`, or `production`. |
| `HOST` | `127.0.0.1` local; `0.0.0.0` Render | Listen address. |
| `PORT` | `3000` | HTTP port assigned by Render in cloud mode. |
| `BASE_URL` | `http://localhost:3000` | Public absolute application URL. |
| `DATABASE_URL` | PostgreSQL profiles | PostgreSQL URL; never logged. |
| `MIGRATION_DATABASE_URL` | Optional; falls back to `DATABASE_URL` | Direct PostgreSQL URL used only by migration commands. For Neon, use the non-pooler URL. |
| `SQLITE_PATH` | `./data/quick-interview.sqlite` | Local SQLite file or `:memory:` in tests. |
| `LOG_LEVEL` | `info` | Pino log level. |
| `SESSION_TTL_MINUTES` | `480` | Administrative session lifetime. |
| `CANDIDATE_TOKEN_TTL_MINUTES` | `10080` | Maximum default candidate-link lifetime. |
| `RUNNER_TOKEN_TTL_MINUTES` | `15` | One-time runner exchange lifetime. |
| `RUNNER_CREDENTIAL_TTL_MINUTES` | `180` | Exchanged runner credential lifetime. |
| `LOGIN_WINDOW_MINUTES` | `15` | Brute-force accounting window. |
| `LOGIN_MAX_FAILURES` | `5` | Allowed failures per account/network window. |
| `HEARTBEAT_OFFLINE_SECONDS` | `90` | Age after which a ready deployment is offline. |
| `DATA_RETENTION_DAYS` | `365` | Default operator retention target. |
| `BOOTSTRAP_ADMIN_EMAIL` | bootstrap only | Initial administrator email. |
| `BOOTSTRAP_ADMIN_PASSWORD` | bootstrap only | Initial administrator password; remove after use. |

See `.env.example` for a safe local template. Production secrets belong in Render environment configuration, not in files. The [Neon-to-Render guide](NEON_RENDER_SETUP.md) shows the recommended pooled runtime/direct migration setup.
