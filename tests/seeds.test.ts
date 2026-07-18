import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapUser, type AuthContext } from '../src/auth/service.js';
import { seedStarterQuestionBank, starterQuestionBank } from '../src/seeds/starter-question-bank.js';
import { createTestContext } from './helpers.js';

let database: Knex | undefined;
afterEach(async () => database?.destroy());

describe('starter question library', () => {
  it('publishes exactly 20 questions per starter domain and is idempotent', async () => {
    const context = await createTestContext();
    database = context.database;
    const user = await bootstrapUser(database, {
      email: 'admin@example.com', password: 'correct horse battery staple', role: 'ADMIN', mustChangePassword: false,
    });
    const auth: AuthContext = {
      sessionId: 'seed-test', csrfToken: 'seed-test',
      user: { id: user.id, email: 'admin@example.com', role: 'ADMIN', mustChangePassword: false },
    };

    expect(starterQuestionBank.filter((item) => item.question.domain === 'AUTOMATION_TESTING')).toHaveLength(20);
    expect(starterQuestionBank.filter((item) => item.question.domain === 'PERFORMANCE_TESTING')).toHaveLength(20);
    await expect(seedStarterQuestionBank(database, auth)).resolves.toEqual({ inserted: 40, skipped: 0 });
    await expect(seedStarterQuestionBank(database, auth)).resolves.toEqual({ inserted: 0, skipped: 40 });

    const counts = await database('questions as entities')
      .join('question_versions as versions', function joinCurrent() {
        this.on('versions.question_id', 'entities.id').andOn('versions.version', 'entities.current_version');
      })
      .select('versions.domain').count<{ domain: string; count: number | string }[]>({ count: '*' })
      .where('entities.status', 'PUBLISHED').groupBy('versions.domain').orderBy('versions.domain');
    expect(counts.map((row) => ({ domain: row.domain, count: Number(row.count) }))).toEqual([
      { domain: 'AUTOMATION_TESTING', count: 20 },
      { domain: 'PERFORMANCE_TESTING', count: 20 },
    ]);
    expect(await database('question_library_seeds').count<{ count: number | string }[]>({ count: '*' }))
      .toEqual([{ count: 40 }]);
  });
});

