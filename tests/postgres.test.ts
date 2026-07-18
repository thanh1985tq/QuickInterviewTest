import pino from 'pino';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/connection.js';
import { migrateDatabase, rollbackDatabase } from '../src/db/migrations.js';

const postgresUrl = process.env.TEST_POSTGRES_URL;
if (!postgresUrl) {
  describe.skip('PostgreSQL repository contract', () => {
    it('requires TEST_POSTGRES_URL', () => undefined);
  });
} else {
  describe('PostgreSQL repository contract', () => {
    const config = loadConfig({
      APP_PROFILE: 'local-postgres', NODE_ENV: 'test', DATABASE_URL: postgresUrl, LOG_LEVEL: 'silent',
    });
    const database = createDatabase(config);
    const app = createApp({ config, database, logger: pino({ level: 'silent' }) });

    afterAll(async () => {
      await rollbackDatabase(database);
      await database.destroy();
    });

    it('applies the same migration contract and probes readiness', async () => {
      await migrateDatabase(database);
      expect(await database.schema.hasTable('candidate_attempts')).toBe(true);
      expect(app).toBeTruthy();
    });
  });
}
