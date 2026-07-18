import request from 'supertest';
import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapUser } from '../src/auth/service.js';
import { createTestContext } from './helpers.js';

let database: Knex | undefined;
afterEach(async () => database?.destroy());

async function adminContext() {
  const context = await createTestContext();
  database = context.database;
  await bootstrapUser(database, {
    email: 'admin@example.com', password: 'correct horse battery staple', role: 'ADMIN', mustChangePassword: false,
  });
  const login = await request(context.app).post('/api/auth/login').send({
    email: 'admin@example.com', password: 'correct horse battery staple',
  }).expect(200);
  const cookies = login.headers['set-cookie'] as unknown as string[];
  return {
    ...context,
    cookie: (cookies[0] as string).split(';')[0] as string,
    csrf: (login.body as { csrfToken: string }).csrfToken,
  };
}

function securityQuestion() {
  return {
    title: 'Security regression strategy', description: 'Tests a custom domain.',
    prompt: 'Describe how you would automate authorization regression coverage.', domain: 'SECURITY_TESTING',
    type: 'SCENARIO', difficulty: 'MID', expectedDurationMinutes: 10, maximumScore: 10,
    choices: [], answerKey: { correctChoiceIds: [] },
    scoringRubric: 'Award points for role boundaries, negative tests, data isolation, and repeatable evidence.',
    tags: ['authorization'],
  };
}

describe('domain management', () => {
  it('creates, edits, archives, and reactivates interview domains', async () => {
    const context = await adminContext();
    const defaults = await request(context.app).get('/api/domains?status=ALL').set('Cookie', context.cookie).expect(200);
    expect((defaults.body as { domains: unknown[] }).domains).toHaveLength(2);

    const created = await request(context.app).post('/api/domains')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send({ name: 'Security Testing', description: 'Application security interview questions.' }).expect(201);
    const domainId = (created.body as { id: string }).id;

    await request(context.app).put(`/api/domains/${domainId}`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send({ description: 'Security automation, access control, and abuse cases.' }).expect(204);
    await request(context.app).post('/api/questions')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send(securityQuestion()).expect(201);

    await request(context.app).post(`/api/domains/${domainId}/archive`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send({}).expect(204);
    const blocked = await request(context.app).post('/api/questions')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send(securityQuestion()).expect(409);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('DOMAIN_ARCHIVED');

    await request(context.app).post(`/api/domains/${domainId}/reactivate`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send({}).expect(204);
    const domains = await request(context.app).get('/api/domains?status=ALL').set('Cookie', context.cookie).expect(200);
    const security = (domains.body as { domains: Array<{ slug: string; questionCount: number; isActive: boolean }> })
      .domains.find((domain) => domain.slug === 'SECURITY_TESTING');
    expect(security).toMatchObject({ questionCount: 1, isActive: true });
  });
});

