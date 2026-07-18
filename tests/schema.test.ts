import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { nowIso } from '../src/domain/types.js';
import { createTestContext } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { backupSqlite } from '../src/db/sqlite-backup.js';

let database: Knex | undefined;
afterEach(async () => database?.destroy());

describe('portable core schema', () => {
  it('creates every core domain table', async () => {
    const context = await createTestContext();
    database = context.database;
    const required = [
      'users', 'user_sessions', 'login_attempts', 'questions', 'question_versions', 'tags', 'question_tags',
      'test_templates', 'test_template_versions', 'test_template_questions', 'test_instances',
      'test_instance_questions', 'candidates', 'candidate_attempts', 'answers', 'attempt_events',
      'deployments', 'runner_tokens', 'scores', 'review_comments', 'admin_audit_log',
    ];
    for (const table of required) expect(await database.schema.hasTable(table), table).toBe(true);
  });

  it('enforces unique and referential constraints', async () => {
    const context = await createTestContext();
    database = context.database;
    const timestamp = nowIso();
    const user = {
      id: randomUUID(), email: 'unique@example.com', password_hash: 'test', role: 'ADMIN', is_active: true,
      must_change_password: false, created_at: timestamp, updated_at: timestamp,
    };
    await database('users').insert(user);
    await expect(database('users').insert({ ...user, id: randomUUID() })).rejects.toThrow();
    await expect(database('questions').insert({
      id: randomUUID(), author_user_id: randomUUID(), status: 'DRAFT', current_version: 1,
      created_at: timestamp, updated_at: timestamp,
    })).rejects.toThrow();
  });

  it('creates a restorable online SQLite backup without overwriting', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'qit-backup-test-'));
    try {
      const source = join(directory, 'source.sqlite');
      const destination = join(directory, 'backup.sqlite');
      const config = loadConfig({ APP_PROFILE: 'test', NODE_ENV: 'test', SQLITE_PATH: source, LOG_LEVEL: 'silent' });
      const sourceDatabase = createDatabase(config);
      await migrateDatabase(sourceDatabase);
      await sourceDatabase.destroy();
      await backupSqlite(source, destination);
      const backupDatabase = createDatabase(loadConfig({
        APP_PROFILE: 'test', NODE_ENV: 'test', SQLITE_PATH: destination, LOG_LEVEL: 'silent',
      }));
      expect(await backupDatabase.schema.hasTable('candidate_attempts')).toBe(true);
      await backupDatabase.destroy();
      await expect(backupSqlite(source, destination)).rejects.toThrow(/already exists/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
