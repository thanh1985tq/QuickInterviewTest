import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { backupSqlite } from '../db/sqlite-backup.js';

const config = loadConfig();
if (config.database.client !== 'sqlite' || config.database.filename === ':memory:') {
  throw new Error('backup:sqlite requires a file-backed SQLite profile');
}

const source = resolve(config.database.filename);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = resolve(process.argv[2] ?? `./backups/quick-interview-${stamp}.sqlite`);
const created = await backupSqlite(source, destination);
process.stdout.write(`SQLite backup created: ${created}\n`);
