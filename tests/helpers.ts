import type { Knex } from 'knex';
import pino from 'pino';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrations.js';

export async function createTestContext(
  overrides: NodeJS.ProcessEnv = {},
): Promise<{ database: Knex; app: ReturnType<typeof createApp> }> {
  const config = loadConfig({
    APP_PROFILE: 'test', NODE_ENV: 'test', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent', ...overrides,
  });
  const database = createDatabase(config);
  await migrateDatabase(database);
  const app = createApp({ config, database, logger: pino({ level: 'silent' }) });
  return { database, app };
}
