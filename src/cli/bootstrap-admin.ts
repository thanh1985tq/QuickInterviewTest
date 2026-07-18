import { z } from 'zod';
import { bootstrapUser } from '../auth/service.js';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/connection.js';
import { migrateDatabase } from '../db/migrations.js';

const input = z.object({
  BOOTSTRAP_ADMIN_EMAIL: z.string().email(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(1024),
}).parse(process.env);

const config = loadConfig();
const database = createDatabase(config);
try {
  await migrateDatabase(database);
  const result = await bootstrapUser(database, {
    email: input.BOOTSTRAP_ADMIN_EMAIL,
    password: input.BOOTSTRAP_ADMIN_PASSWORD,
    role: 'ADMIN',
    mustChangePassword: true,
  });
  process.stdout.write(`Bootstrap administrator ${result.created ? 'created' : 'updated'}.\n`);
} finally {
  await database.destroy();
}
