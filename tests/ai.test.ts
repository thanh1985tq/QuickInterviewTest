import request from 'supertest';
import type { Knex } from 'knex';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootstrapUser } from '../src/auth/service.js';
import { createTestContext } from './helpers.js';

let database: Knex | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await database?.destroy();
});

async function authenticatedContext() {
  const context = await createTestContext({
    OPEN_API_URL: 'https://ollama.com/v1',
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'gpt-oss:120b',
  });
  database = context.database;
  await bootstrapUser(database, {
    email: 'interviewer@example.com', password: 'correct horse battery staple', role: 'INTERVIEWER', mustChangePassword: false,
  });
  const login = await request(context.app).post('/api/auth/login').send({
    email: 'interviewer@example.com', password: 'correct horse battery staple',
  }).expect(200);
  const header = login.headers['set-cookie'] as unknown as string[];
  const cookie = (header[0] as string).split(';')[0] as string;
  const csrf = (login.body as { csrfToken: string }).csrfToken;
  return { ...context, cookie, csrf };
}

describe('AI Assistant question generation', () => {
  it('uses the configured chat-completions provider and validates returned question drafts', async () => {
    const context = await authenticatedContext();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify({
              questions: [{
                title: 'API automation contract checks',
                description: 'Assesses API automation design.',
                prompt: 'Which check belongs closest to an API contract test?',
                domain: 'AUTOMATION_TESTING',
                type: 'SINGLE_CHOICE',
                difficulty: 'MID',
                expectedDurationMinutes: 5,
                maximumScore: 10,
                choices: [
                  { id: 'choice_1', label: 'Only compare screenshots' },
                  { id: 'choice_2', label: 'Validate response schema and required semantics' },
                ],
                answerKey: { correctChoiceIds: ['choice_2'] },
                scoringRubric: '',
                tags: ['api', 'automation'],
              }],
            }),
          },
        }],
      }),
    } as Response);

    const response = await request(context.app).post('/api/ai/questions')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send({ domain: 'AUTOMATION_TESTING', count: 1, topic: 'API tests', difficulty: 'MID' })
      .expect(200);

    expect(fetchMock).toHaveBeenCalledWith('https://ollama.com/v1/chat/completions', expect.objectContaining({ method: 'POST' }));
    expect((response.body as { questions: Array<{ title: string }> }).questions[0]?.title).toBe('API automation contract checks');
  });

  it('returns a clear service error when AI settings are missing', async () => {
    const context = await createTestContext();
    database = context.database;
    await bootstrapUser(database, {
      email: 'interviewer@example.com', password: 'correct horse battery staple', role: 'INTERVIEWER', mustChangePassword: false,
    });
    const login = await request(context.app).post('/api/auth/login').send({
      email: 'interviewer@example.com', password: 'correct horse battery staple',
    }).expect(200);
    const header = login.headers['set-cookie'] as unknown as string[];
    const cookie = (header[0] as string).split(';')[0] as string;
    const csrf = (login.body as { csrfToken: string }).csrfToken;
    const response = await request(context.app).post('/api/ai/questions')
      .set('Cookie', cookie).set('X-CSRF-Token', csrf)
      .send({ domain: 'AUTOMATION_TESTING', count: 1 }).expect(503);
    expect((response.body as { error: { code: string } }).error.code).toBe('AI_NOT_CONFIGURED');
  });
});
