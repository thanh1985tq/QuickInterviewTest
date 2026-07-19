# Connect Neon PostgreSQL to Render

This project uses two Neon connection strings in production:

| Render variable | Neon connection | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Pooled; hostname contains `-pooler` | Normal QuickInterviewTest web traffic. |
| `MIGRATION_DATABASE_URL` | Direct; hostname does not contain `-pooler` | Schema migrations during the Render build. |

Neon recommends pooled connections for web applications and direct connections for schema migrations. Copy each complete URL from Neon, including its TLS query parameters. Never commit either URL.

## 1. Copy both URLs from Neon

1. Sign in to the [Neon Console](https://console.neon.tech/). If the account has no project yet, create one for QuickInterviewTest, then open its Project Dashboard.
2. On the Project Dashboard, select **Connect**.
3. Select the production branch, database, and role. Keep the same selection while copying both URLs.
4. Enable **Connection pooling**. Copy the complete connection string and keep it temporarily as the pooled URL. Its hostname must contain `-pooler`.
5. Disable **Connection pooling**. Copy the complete connection string and keep it temporarily as the direct URL. Its hostname must not contain `-pooler`.
6. Do not remove `sslmode=require`, `channel_binding=require`, or other parameters supplied by Neon.

Example shapes only; do not use these literal values:

```text
DATABASE_URL=postgresql://USER:PASSWORD@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=require&channel_binding=require
MIGRATION_DATABASE_URL=postgresql://USER:PASSWORD@ep-example.region.aws.neon.tech/neondb?sslmode=require&channel_binding=require
```

See Neon's [connection pooling guide](https://neon.com/docs/connect/connection-pooling) for the pooled/direct distinction and its [connection troubleshooting guide](https://neon.com/docs/connect/connection-errors) for TLS and authentication errors.

## 2. Add the values to Render

`render.yaml` already defines the Node service and marks the three deployment-specific values as secrets. Do not put real values in that file.

For a new Blueprint deployment:

1. In Render, create a new Blueprint from this repository.
2. When Render prompts for `DATABASE_URL`, paste the pooled Neon URL.
3. For `MIGRATION_DATABASE_URL`, paste the direct Neon URL.
4. For `BASE_URL`, enter the expected public HTTPS address, such as `https://quick-interview-test.onrender.com`.
5. Create the Blueprint. If Render assigns a different public hostname, correct `BASE_URL` under the service's **Environment** page and redeploy.

For an existing Render service:

1. Open the service in the Render Dashboard.
2. Select **Environment** and add or update the variables below.
3. Save with **Save, rebuild, and deploy**.

| Name | Value |
| --- | --- |
| `APP_PROFILE` | `render-postgres` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `DATABASE_URL` | Pooled Neon URL. |
| `MIGRATION_DATABASE_URL` | Direct Neon URL. |
| `BASE_URL` | The exact Render service URL, beginning with `https://`. |
| `OPENAI_API_URL` or `OPEN_API_URL` | Optional OpenAI-compatible AI Assistant base URL, for example `https://ollama.com/v1`. |
| `OPENAI_API_KEY` | Optional AI Assistant provider key. |
| `OPENAI_MODEL` | Optional AI Assistant model name, for example `gpt-oss:120b`. |

Render uses `sync: false` to request secret values only when a Blueprint is first created. Adding that declaration later does not populate an existing service, so existing services must receive the new value on the **Environment** page. See Render's [environment variable guide](https://render.com/docs/configure-environment-variables) and [Blueprint reference](https://render.com/docs/blueprint-spec).

During deployment, the build command compiles the application and runs migrations through `MIGRATION_DATABASE_URL`. The running web process uses only `DATABASE_URL`. A failed migration stops the deployment instead of starting the new version against an old schema.

## 3. Bootstrap the first administrator

Do this once from a trusted workstation. Use the direct Neon URL and temporary environment variables; do not store the bootstrap password in Render.

```powershell
$temporaryPassword = node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
$env:APP_PROFILE = 'local-postgres'
$env:NODE_ENV = 'production'
$env:DATABASE_URL = '<paste the direct Neon URL>'
$env:BOOTSTRAP_ADMIN_EMAIL = 'admin@example.com'
$env:BOOTSTRAP_ADMIN_PASSWORD = $temporaryPassword
npm.cmd ci
npm.cmd run bootstrap-admin
Write-Host "Temporary password: $temporaryPassword"

Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD
Remove-Item Env:BOOTSTRAP_ADMIN_EMAIL
Remove-Item Env:DATABASE_URL
Remove-Item Env:NODE_ENV
Remove-Item Env:APP_PROFILE
$temporaryPassword = $null
```

Open the production `/login` page and sign in. The bootstrap administrator must change the temporary password before administrative APIs become available.

To add the optional 40-question starter library, follow **Load the starter question library** in [Render operations](OPERATIONS.md). Use the same direct Neon URL and the existing administrator email; the seed is safe to rerun.

## 4. Verify the connection

1. Confirm the Render build log ends with `Database migrations are current.` and the deployment becomes live.
2. Open `https://YOUR-SERVICE.onrender.com/health`; expect `{"status":"ok","service":"quick-interview-test"}`.
3. Open `https://YOUR-SERVICE.onrender.com/ready`; expect `{"status":"ready","database":"connected"}`. A sleeping Neon compute can add a short delay to its first connection.
4. Open `/login`, sign in, and confirm the forced password-change flow.
5. Redeploy once and confirm that login data remains available. PostgreSQL data must survive Render restarts because no persistent data is stored on Render's filesystem.

## Troubleshooting

- **Render build cannot connect:** verify that `MIGRATION_DATABASE_URL` is the direct URL and its hostname does not contain `-pooler`.
- **`/ready` returns 503:** verify that `DATABASE_URL` is the pooled URL, the Neon project/branch is active, and the complete TLS parameters were copied.
- **Password authentication failed:** use Neon's **Connect** dialog to recopy both URLs. Changing a Neon role password invalidates both saved Render values.
- **A Blueprint update did not add the secret:** add it manually under Render **Environment**; `sync: false` is ignored for existing Blueprint instances.
- **Secret appeared in a commit or log:** rotate the Neon role password, replace both Render values, and redeploy.
