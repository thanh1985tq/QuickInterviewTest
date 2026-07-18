import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export async function backupSqlite(sourcePath: string, destinationPath: string): Promise<string> {
  const source = resolve(sourcePath);
  const destination = resolve(destinationPath);
  if (!existsSync(source)) throw new Error(`SQLite database does not exist: ${source}`);
  if (existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);
  mkdirSync(dirname(destination), { recursive: true });
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await database.backup(destination);
    return destination;
  } finally {
    database.close();
  }
}
