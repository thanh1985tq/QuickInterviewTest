import request from 'supertest';
import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapUser } from '../src/auth/service.js';
import { createTestContext } from './helpers.js';

let database: Knex | undefined;
afterEach(async () => database?.destroy());

async function authenticatedContext() {
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
  return { ...context, cookie, csrf };
}

function singleChoice(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Choose a browser automation strategy',
    description: 'Tests architecture judgment',
    prompt: 'Which option provides the strongest isolation?',
    domain: 'AUTOMATION_TESTING',
    type: 'SINGLE_CHOICE',
    difficulty: 'MID',
    expectedDurationMinutes: 5,
    maximumScore: 10,
    choices: [{ id: 'a', label: 'Shared mutable fixture' }, { id: 'b', label: 'Independent fixture' }],
    answerKey: { correctChoiceIds: ['b'] },
    scoringRubric: '',
    tags: ['Playwright', 'Test architecture'],
    ...overrides,
  };
}

describe('question bank and templates', () => {
  it('requires CSRF and validates question-specific scoring inputs', async () => {
    const context = await authenticatedContext();
    await request(context.app).post('/api/questions').set('Cookie', context.cookie).send(singleChoice()).expect(403);
    const invalid = singleChoice({ answerKey: { correctChoiceIds: ['missing'] } });
    const response = await request(context.app).post('/api/questions')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send(invalid).expect(400);
    expect((response.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('creates, searches, duplicates, publishes, and versions questions without mutating a published version', async () => {
    const context = await authenticatedContext();
    const created = await request(context.app).post('/api/questions')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send(singleChoice()).expect(201);
    const first = created.body as { id: string; versionId: string; version: number };
    expect(first.version).toBe(1);

    const search = await request(context.app).get('/api/questions?tag=playwright&search=browser')
      .set('Cookie', context.cookie).expect(200);
    expect((search.body as { questions: unknown[] }).questions).toHaveLength(1);
    await request(context.app).post(`/api/questions/${first.id}/publish`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).expect(200);
    const publishedBefore = await context.database<Record<string, unknown>>('question_versions').where({ id: first.versionId }).first();

    const updated = await request(context.app).put(`/api/questions/${first.id}`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send(singleChoice({ title: 'Revised automation strategy' })).expect(200);
    expect((updated.body as { version: number; status: string }).version).toBe(2);
    expect((updated.body as { status: string }).status).toBe('DRAFT');
    const publishedAfter = await context.database<Record<string, unknown>>('question_versions').where({ id: first.versionId }).first();
    expect(publishedAfter).toEqual(publishedBefore);

    const history = await request(context.app).get(`/api/questions/${first.id}/versions`)
      .set('Cookie', context.cookie).expect(200);
    expect((history.body as { versions: unknown[] }).versions).toHaveLength(2);
    const duplicate = await request(context.app).post(`/api/questions/${first.id}/duplicate`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).expect(201);
    expect((duplicate.body as { id: string }).id).not.toBe(first.id);
  });

  it('downloads a draft-import JSON template that can be uploaded directly', async () => {
    const context = await authenticatedContext();
    const template = await request(context.app).get('/api/questions/import-template.json')
      .set('Cookie', context.cookie).expect(200);
    const document: unknown = template.body;
    const dryRun = await request(context.app).post('/api/questions/import')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send({ dryRun: true, document }).expect(200);
    expect((dryRun.body as { conflicts: unknown[] }).conflicts).toHaveLength(0);
    const imported = await request(context.app).post('/api/questions/import')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send({ dryRun: false, document }).expect(200);
    expect((imported.body as { imported: number }).imported).toBe(1);
    expect(await context.database('questions').count<{ count: number }[]>({ count: '*' })).toEqual([{ count: 1 }]);
  });

  it('publishes selected draft questions in one batch', async () => {
    const context = await authenticatedContext();
    const first = await request(context.app).post('/api/questions')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send(singleChoice({ title: 'Batch publish one' })).expect(201);
    const second = await request(context.app).post('/api/questions')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send(singleChoice({ title: 'Batch publish two' })).expect(201);
    const response = await request(context.app).post('/api/questions/batch/publish')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send({ questionIds: [(first.body as { id: string }).id, (second.body as { id: string }).id] }).expect(200);
    expect((response.body as { published: number }).published).toBe(2);
    const statuses = await context.database('questions').orderBy('created_at').pluck<string[]>('status');
    expect(statuses).toEqual(['PUBLISHED', 'PUBLISHED']);
  });

  it('builds and versions a validated template using only published questions', async () => {
    const context = await authenticatedContext();
    const question = await request(context.app).post('/api/questions')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send(singleChoice()).expect(201);
    const questionBody = question.body as { id: string; versionId: string };

    const templateInput = {
      title: 'Automation engineer screen',
      description: 'A short practical screen',
      domain: 'AUTOMATION_TESTING',
      targetSeniority: 'MID',
      durationMinutes: 30,
      randomizeQuestions: false,
      selectionMode: 'FIXED',
      sections: [{ key: 'architecture', title: 'Architecture', maximumScore: 10 }],
      navigation: { allowBack: true, requireSequential: false },
      questions: [{
        questionVersionId: questionBody.versionId, sectionKey: 'architecture', position: 1, scoreWeight: 1, required: true,
      }],
    };
    await request(context.app).post('/api/templates')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send(templateInput).expect(400);
    await request(context.app).post(`/api/questions/${questionBody.id}/publish`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).expect(200);

    const created = await request(context.app).post('/api/templates')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send(templateInput).expect(201);
    const template = created.body as { id: string; versionId: string };
    const preview = await request(context.app).get(`/api/templates/${template.id}/preview`)
      .set('Cookie', context.cookie).expect(200);
    const previewQuestion = (preview.body as { questions: Record<string, unknown>[] }).questions[0] as Record<string, unknown>;
    expect(previewQuestion.answerKey).toBeUndefined();
    expect(previewQuestion.scoringRubric).toBeUndefined();

    await request(context.app).post(`/api/templates/${template.id}/publish`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).expect(200);
    const oldVersion = await context.database<Record<string, unknown>>('test_template_versions').where({ id: template.versionId }).first();
    const updatedInput = { ...templateInput, title: 'Automation engineer screen v2' };
    const updated = await request(context.app).put(`/api/templates/${template.id}`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send(updatedInput).expect(200);
    expect((updated.body as { version: number }).version).toBe(2);
    expect(await context.database<Record<string, unknown>>('test_template_versions').where({ id: template.versionId }).first()).toEqual(oldVersion);

    const questionExport = await request(context.app).get('/api/questions/export.json')
      .set('Cookie', context.cookie).expect(200);
    const templateExport = await request(context.app).get('/api/templates/export.json')
      .set('Cookie', context.cookie).expect(200);
    const questionDocument: unknown = questionExport.body;
    const templateDocument: unknown = templateExport.body;
    const conflictCheck = await request(context.app).post('/api/questions/import')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send({ dryRun: true, document: questionDocument }).expect(200);
    expect((conflictCheck.body as { conflicts: unknown[] }).conflicts.length).toBeGreaterThan(0);
    await request(context.app).post('/api/questions/import')
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send({ dryRun: false, document: questionDocument }).expect(409);

    const target = await createTestContext();
    try {
      await bootstrapUser(target.database, {
        email: 'target@example.com', password: 'correct horse battery staple', role: 'INTERVIEWER', mustChangePassword: false,
      });
      const targetLogin = await request(target.app).post('/api/auth/login').send({
        email: 'target@example.com', password: 'correct horse battery staple',
      }).expect(200);
      const targetHeaders = targetLogin.headers['set-cookie'] as unknown as string[];
      const targetCookie = (targetHeaders[0] as string).split(';')[0] as string;
      const targetCsrf = (targetLogin.body as { csrfToken: string }).csrfToken;
      const dryRun = await request(target.app).post('/api/questions/import')
        .set('Cookie', targetCookie).set('X-CSRF-Token', targetCsrf)
        .send({ dryRun: true, document: questionDocument }).expect(200);
      expect((dryRun.body as { conflicts: unknown[] }).conflicts).toHaveLength(0);
      expect(await target.database('questions').count<{ count: number }[]>({ count: '*' })).toEqual([{ count: 0 }]);
      await request(target.app).post('/api/questions/import')
        .set('Cookie', targetCookie).set('X-CSRF-Token', targetCsrf)
        .send({ dryRun: false, document: questionDocument }).expect(200);
      await request(target.app).post('/api/templates/import')
        .set('Cookie', targetCookie).set('X-CSRF-Token', targetCsrf)
        .send({ dryRun: false, document: templateDocument }).expect(200);
      expect(await target.database('questions').count<{ count: number }[]>({ count: '*' })).toEqual([{ count: 1 }]);
      expect(await target.database('test_templates').count<{ count: number }[]>({ count: '*' })).toEqual([{ count: 1 }]);
    } finally {
      await target.database.destroy();
    }
  });
});
