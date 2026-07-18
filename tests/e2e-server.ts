import pino from 'pino';
import { bootstrapUser } from '../src/auth/service.js';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrations.js';

const config = loadConfig({
  APP_PROFILE: 'test', NODE_ENV: 'test', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent',
  HOST: '127.0.0.1', PORT: '3210', BASE_URL: 'http://127.0.0.1:3210',
});
const database = createDatabase(config);
await migrateDatabase(database);
await bootstrapUser(database, {
  email: 'admin@example.com', password: 'correct horse battery staple', role: 'ADMIN', mustChangePassword: false,
});
const app = createApp({ config, database, logger: pino({ level: 'silent' }) });
const server = app.listen(config.port, config.host);

async function close(): Promise<void> {
  server.close();
  await database.destroy();
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
