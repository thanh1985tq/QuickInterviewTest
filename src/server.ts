import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/connection.js';
import { migrateDatabase } from './db/migrations.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const database = createDatabase(config);
if (config.profile !== 'render-postgres') await migrateDatabase(database);
const app = createApp({ config, database, logger });

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, profile: config.profile }, 'server started');
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await database.destroy();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
