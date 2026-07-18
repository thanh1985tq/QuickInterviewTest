import { z } from 'zod';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/connection.js';
import { migrateDatabase } from '../db/migrations.js';
import type { AuthContext } from '../auth/service.js';
import { seedStarterQuestionBank } from '../seeds/starter-question-bank.js';

const input = z.object({
  SEED_ADMIN_EMAIL: z.string().email(),
}).parse(process.env);

const config = loadConfig();
const database = createDatabase(config);
try {
  await migrateDatabase(database);
  const user = await database<{
    id: string; email: string; role: 'ADMIN'; is_active: boolean | number; must_change_password: boolean | number;
  }>('users').where({ email: input.SEED_ADMIN_EMAIL.trim().toLocaleLowerCase('en-US'), role: 'ADMIN' }).first();
  if (!user || !user.is_active) throw new Error('SEED_ADMIN_EMAIL must identify an active administrator');
  const auth: AuthContext = {
    sessionId: 'question-bank-seed', csrfToken: 'question-bank-seed',
    user: { id: user.id, email: user.email, role: user.role, mustChangePassword: Boolean(user.must_change_password) },
  };
  const result = await seedStarterQuestionBank(database, auth);
  process.stdout.write(`Starter question bank current: ${result.inserted} inserted, ${result.skipped} already present.\n`);
} finally {
  await database.destroy();
}

