import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import knex, { type Knex } from 'knex';
import type { AppConfig } from '../config.js';

export function createDatabase(config: AppConfig): Knex {
  if (config.database.client === 'sqlite') {
    const filename = config.database.filename === ':memory:'
      ? ':memory:'
      : resolve(config.database.filename);
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });

    const database = knex({
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      pool: {
        afterCreate(connection: { pragma: (sql: string) => unknown }, done: (error: Error | null, connection: unknown) => void) {
          try {
            connection.pragma('foreign_keys = ON');
            connection.pragma('journal_mode = WAL');
            done(null, connection);
          } catch (error) {
            done(error as Error, connection);
          }
        },
      },
    });
    return database;
  }

  return knex({
    client: 'pg',
    connection: config.database.url,
    pool: { min: 0, max: 10 },
  });
}

export async function databaseReady(database: Knex): Promise<boolean> {
  try {
    await database.raw('select 1 as ok');
    return true;
  } catch {
    return false;
  }
}
