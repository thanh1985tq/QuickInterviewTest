import { loadConfig } from '../config.js';
import { createDatabase } from '../db/connection.js';
import { migrateDatabase, rollbackDatabase } from '../db/migrations.js';

const config = loadConfig();
const database = createDatabase(config);

try {
  if (process.argv[2] === 'rollback') {
    await rollbackDatabase(database);
    process.stdout.write('Database migration rolled back.\n');
  } else {
    await migrateDatabase(database);
    process.stdout.write('Database migrations are current.\n');
  }
} finally {
  await database.destroy();
}
