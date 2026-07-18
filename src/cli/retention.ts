import { z } from 'zod';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/connection.js';
import { migrateDatabase } from '../db/migrations.js';
import { nowIso } from '../domain/types.js';

const args = z.object({
  anonymizeCandidateId: z.string().uuid().optional(),
}).parse({
  anonymizeCandidateId: process.argv.includes('--anonymize-candidate')
    ? process.argv[process.argv.indexOf('--anonymize-candidate') + 1]
    : undefined,
});

const config = loadConfig();
const database = createDatabase(config);
try {
  await migrateDatabase(database);
  const timestamp = nowIso();
  const loginCutoff = new Date(Date.now() - Math.max(30, config.dataRetentionDays) * 86_400_000).toISOString();
  const sessions = await database('user_sessions').where('expires_at', '<', timestamp).delete();
  const runnerTokens = await database('runner_tokens').where('expires_at', '<', timestamp).delete();
  const loginAttempts = await database('login_attempts').where('occurred_at', '<', loginCutoff).delete();
  if (args.anonymizeCandidateId) {
    const updated = await database('candidates').where({ id: args.anonymizeCandidateId }).update({
      name: `Anonymized ${args.anonymizeCandidateId.slice(0, 8)}`,
      email: null,
      metadata_json: '{}',
      anonymized_at: timestamp,
      updated_at: timestamp,
    });
    if (!updated) throw new Error('Candidate was not found');
  }
  process.stdout.write(`Retention complete: sessions=${sessions}, runnerTokens=${runnerTokens}, loginAttempts=${loginAttempts}.\n`);
} finally {
  await database.destroy();
}
