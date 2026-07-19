import request from 'supertest';
import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapUser } from '../src/auth/service.js';
import { createTestContext } from './helpers.js';

let database: Knex | undefined;
afterEach(async () => database?.destroy());

async function setupPublishedTemplate() {
  const context = await createTestContext();
  database = context.database;
  await bootstrapUser(database, {
    email: 'interviewer@example.com', password: 'correct horse battery staple', role: 'INTERVIEWER', mustChangePassword: false,
  });
  const login = await request(context.app).post('/api/auth/login').send({
    email: 'interviewer@example.com', password: 'correct horse battery staple',
  }).expect(200);
  const cookieHeader = login.headers['set-cookie'] as unknown as string[];
  const cookie = (cookieHeader[0] as string).split(';')[0] as string;
  const csrf = (login.body as { csrfToken: string }).csrfToken;
  const questionInput = {
    title: 'Isolation strategy', description: 'Select the strongest approach.',
    prompt: 'Which fixture model isolates parallel browser tests?', domain: 'AUTOMATION_TESTING',
    type: 'SINGLE_CHOICE', difficulty: 'MID', expectedDurationMinutes: 5, maximumScore: 10,
    choices: [{ id: 'shared', label: 'One shared page' }, { id: 'isolated', label: 'A context per test' }],
    answerKey: { correctChoiceIds: ['isolated'] }, scoringRubric: '', tags: ['Playwright'],
  };
  const questionResponse = await request(context.app).post('/api/questions')
    .set('Cookie', cookie).set('X-CSRF-Token', csrf).send(questionInput).expect(201);
  const question = questionResponse.body as { id: string; versionId: string };
  await request(context.app).post(`/api/questions/${question.id}/publish`)
    .set('Cookie', cookie).set('X-CSRF-Token', csrf).expect(200);
  const templateInput = {
    title: 'Automation screen', description: 'Complete every required question.', domain: 'AUTOMATION_TESTING',
    targetSeniority: 'MID', durationMinutes: 30, randomizeQuestions: false, selectionMode: 'FIXED',
    sections: [{ key: 'main', title: 'Main', maximumScore: 10 }],
    navigation: { allowBack: true, requireSequential: false },
    questions: [{ questionVersionId: question.versionId, sectionKey: 'main', position: 1, scoreWeight: 1, required: true }],
  };
  const templateResponse = await request(context.app).post('/api/templates')
    .set('Cookie', cookie).set('X-CSRF-Token', csrf).send(templateInput).expect(201);
  const template = templateResponse.body as { id: string };
  await request(context.app).post(`/api/templates/${template.id}/publish`)
    .set('Cookie', cookie).set('X-CSRF-Token', csrf).expect(200);
  return { ...context, cookie, csrf, question, questionInput, template };
}

async function createInstance(
  context: Awaited<ReturnType<typeof setupPublishedTemplate>>, candidateName: string,
  deliveryMode = 'STANDARD_WEB',
) {
  const response = await request(context.app).post('/api/test-instances')
    .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send({
      templateId: context.template.id,
      candidate: { name: candidateName, email: `${candidateName.toLocaleLowerCase('en-US')}@example.com` },
      deliveryMode,
      availableFrom: new Date(Date.now() - 60_000).toISOString(),
      availableUntil: new Date(Date.now() + 3_600_000).toISOString(),
      durationMinutes: 30,
    }).expect(201);
  return response.body as {
    instanceId: string;
    attemptId: string;
    candidateToken: string;
    candidateUrl: string;
    runnerToken?: string;
  };
}

function candidateAuth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

describe('candidate instances and Standard Web delivery', () => {
  it('creates an immutable snapshot and stores only a scoped token hash', async () => {
    const context = await setupPublishedTemplate();
    const instance = await createInstance(context, 'Alice');
    expect(instance.candidateUrl).toContain(`/test/${instance.candidateToken}`);
    const attempt = await context.database<{ id: string; candidate_token_hash: string }>('candidate_attempts')
      .where({ id: instance.attemptId }).first();
    expect(attempt?.candidate_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(attempt?.candidate_token_hash).not.toContain(instance.candidateToken);
    await request(context.app).get(new URL(instance.candidateUrl).pathname).expect(200);

    await request(context.app).put(`/api/questions/${context.question.id}`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send({ ...context.questionInput, title: 'Changed after invitation' }).expect(200);
    const manifest = await request(context.app).get('/api/candidate/attempt')
      .set(candidateAuth(instance.candidateToken)).expect(200);
    const body = manifest.body as { questions: Array<Record<string, unknown>> };
    expect(body.questions[0]?.title).toBe('Isolation strategy');
    expect(JSON.stringify(body)).not.toContain('correctChoiceIds');
    expect(body.questions[0]?.scoringRubric).toBeUndefined();
  });

  it('lets administrators edit candidate details and cancel an unused attempt', async () => {
    const context = await setupPublishedTemplate();
    const instance = await createInstance(context, 'Editable');
    const updated = await request(context.app).put(`/api/test-instances/${instance.instanceId}/candidate`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf)
      .send({ name: 'Updated Candidate', email: 'updated@example.com' }).expect(200);
    expect((updated.body as { name: string; email: string }).name).toBe('Updated Candidate');
    const list = await request(context.app).get('/api/test-instances').set('Cookie', context.cookie).expect(200);
    expect((list.body as { instances: Array<{ candidate: { name: string; email: string } }> }).instances[0]?.candidate)
      .toMatchObject({ name: 'Updated Candidate', email: 'updated@example.com' });

    await request(context.app).delete(`/api/test-instances/${instance.instanceId}`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send({}).expect(204);
    const cancelled = await request(context.app).get('/api/candidate/attempt')
      .set(candidateAuth(instance.candidateToken)).expect(200);
    expect((cancelled.body as { attempt: { state: string } }).attempt.state).toBe('CANCELLED');
    await request(context.app).post('/api/candidate/start').set(candidateAuth(instance.candidateToken)).send({}).expect(410);
  });

  it('reissues a one-time candidate link when the original link was lost', async () => {
    const context = await setupPublishedTemplate();
    const instance = await createInstance(context, 'Linkless');
    const reissued = await request(context.app).post(`/api/test-instances/${instance.instanceId}/candidate-link`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send({}).expect(201);
    const body = reissued.body as { candidateUrl: string; tokenExpiresAt: string };
    expect(body.candidateUrl).toContain('/test/');
    expect(body.candidateUrl).not.toBe(instance.candidateUrl);
    await request(context.app).get('/api/candidate/attempt').set(candidateAuth(instance.candidateToken)).expect(404);
    const newToken = body.candidateUrl.split('/test/')[1] as string;
    await request(context.app).get('/api/candidate/attempt').set(candidateAuth(newToken)).expect(200);
  });

  it('starts with a server deadline, autosaves idempotently, resumes, submits idempotently, and locks answers', async () => {
    const context = await setupPublishedTemplate();
    const instance = await createInstance(context, 'Bob');
    const auth = candidateAuth(instance.candidateToken);
    const started = await request(context.app).post('/api/candidate/start').set(auth).send({}).expect(200);
    const startedBody = started.body as {
      attempt: { deadlineAt: string; state: string };
      questions: Array<{ id: string; answer: unknown }>;
    };
    expect(startedBody.attempt.state).toBe('STARTED');
    const remaining = new Date(startedBody.attempt.deadlineAt).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(29 * 60_000);
    expect(remaining).toBeLessThanOrEqual(30 * 60_000);
    const questionId = startedBody.questions[0]?.id as string;

    const saveBody = { value: 'isolated', idempotencyKey: 'save-operation-0001' };
    const saved = await request(context.app).put(`/api/candidate/answers/${questionId}`).set(auth).send(saveBody).expect(200);
    expect((saved.body as { idempotent: boolean }).idempotent).toBe(false);
    const duplicate = await request(context.app).put(`/api/candidate/answers/${questionId}`).set(auth).send(saveBody).expect(200);
    expect((duplicate.body as { idempotent: boolean }).idempotent).toBe(true);
    expect(await context.database('answers').where({ attempt_id: instance.attemptId }).count<{ count: number }[]>({ count: '*' }))
      .toEqual([{ count: 1 }]);

    const resumed = await request(context.app).get('/api/candidate/attempt').set(auth).expect(200);
    expect((resumed.body as { questions: Array<{ answer: string }> }).questions[0]?.answer).toBe('isolated');
    const submitted = await request(context.app).post('/api/candidate/submit').set(auth)
      .send({ idempotencyKey: 'submit-operation-0001' }).expect(200);
    expect((submitted.body as { idempotent: boolean }).idempotent).toBe(false);
    const automatic = await context.database<{ score: number; kind: string; attempt_id: string }>('scores')
      .where({ attempt_id: instance.attemptId }).first();
    expect(Number(automatic?.score)).toBe(10);
    expect(automatic?.kind).toBe('AUTOMATIC');
    const resubmitted = await request(context.app).post('/api/candidate/submit').set(auth)
      .send({ idempotencyKey: 'submit-operation-0001' }).expect(200);
    expect((resubmitted.body as { idempotent: boolean }).idempotent).toBe(true);
    await request(context.app).put(`/api/candidate/answers/${questionId}`).set(auth)
      .send({ value: 'shared', idempotencyKey: 'save-operation-0002' }).expect(409);

    await bootstrapUser(context.database, {
      email: 'reviewer@example.com', password: 'correct horse battery staple', role: 'REVIEWER', mustChangePassword: false,
    });
    const reviewerLogin = await request(context.app).post('/api/auth/login').send({
      email: 'reviewer@example.com', password: 'correct horse battery staple',
    }).expect(200);
    const reviewerHeaders = reviewerLogin.headers['set-cookie'] as unknown as string[];
    const reviewerCookie = (reviewerHeaders[0] as string).split(';')[0] as string;
    const reviewerCsrf = (reviewerLogin.body as { csrfToken: string }).csrfToken;
    const detail = await request(context.app).get(`/api/results/${instance.attemptId}`).set('Cookie', reviewerCookie).expect(200);
    const answerId = (detail.body as { questions: Array<{ answerId: string }> }).questions[0]?.answerId as string;
    const override = await request(context.app).post(`/api/results/${instance.attemptId}/scores`)
      .set('Cookie', reviewerCookie).set('X-CSRF-Token', reviewerCsrf)
      .send({ answerId, score: 9, reason: 'Reviewer override after rubric check' }).expect(201);
    expect((override.body as { revision: number; kind: string }).revision).toBe(2);
    expect((override.body as { kind: string }).kind).toBe('OVERRIDE');
    await request(context.app).post(`/api/results/${instance.attemptId}/comments`)
      .set('Cookie', reviewerCookie).set('X-CSRF-Token', reviewerCsrf)
      .send({ questionId, comment: 'Clear explanation supplied.' }).expect(201);
    const reviewed = await request(context.app).get(`/api/results/${instance.attemptId}`).set('Cookie', reviewerCookie).expect(200);
    expect((reviewed.body as { score: number; questions: Array<{ scores: unknown[] }>; comments: unknown[] }).score).toBe(9);
    expect((reviewed.body as { questions: Array<{ scores: unknown[] }> }).questions[0]?.scores).toHaveLength(2);
    expect((reviewed.body as { comments: unknown[] }).comments).toHaveLength(1);
    const csv = await request(context.app).get('/api/results/export.csv').set('Cookie', reviewerCookie).expect(200);
    expect(csv.text).toContain('Bob');
  });

  it('isolates candidates and rejects expired tokens', async () => {
    const context = await setupPublishedTemplate();
    const alice = await createInstance(context, 'Alice');
    const bob = await createInstance(context, 'Bob');
    const aliceStarted = await request(context.app).post('/api/candidate/start')
      .set(candidateAuth(alice.candidateToken)).send({}).expect(200);
    await request(context.app).post('/api/candidate/start').set(candidateAuth(bob.candidateToken)).send({}).expect(200);
    const aliceQuestion = (aliceStarted.body as { questions: Array<{ id: string }> }).questions[0]?.id as string;
    await request(context.app).put(`/api/candidate/answers/${aliceQuestion}`).set(candidateAuth(bob.candidateToken))
      .send({ value: 'isolated', idempotencyKey: 'cross-attempt-0001' }).expect(404);

    await context.database('candidate_attempts').where({ id: alice.attemptId })
      .update({ token_expires_at: new Date(Date.now() - 1000).toISOString() });
    await request(context.app).get('/api/candidate/attempt').set(candidateAuth(alice.candidateToken)).expect(410);
  });

  it('runs Lab Mode through a single-use runner credential and recovers saved answers after relaunch', async () => {
    const context = await setupPublishedTemplate();
    const instance = await createInstance(context, 'LabCandidate', 'COLAB_GRADIO');
    expect(instance.runnerToken).toBeTruthy();
    expect(instance.runnerToken).not.toBe(instance.candidateToken);
    await request(context.app).get(new URL(instance.candidateUrl).pathname).expect(409);

    const exchange = await request(context.app).post('/api/runner/exchange')
      .send({ runnerToken: instance.runnerToken }).expect(201);
    const exchanged = exchange.body as {
      runnerCredential: string;
      gradioUsername: string;
      gradioPassword: string;
      generation: number;
    };
    expect(exchanged.generation).toBe(1);
    expect(exchanged.gradioPassword).toBeTruthy();
    await request(context.app).post('/api/runner/exchange').send({ runnerToken: instance.runnerToken }).expect(409);
    const runnerAuth = candidateAuth(exchanged.runnerCredential);
    const manifest = await request(context.app).get('/api/runner/manifest').set(runnerAuth).expect(200);
    expect(JSON.stringify(manifest.body)).not.toContain('correctChoiceIds');
    await request(context.app).get(`/api/test-instances/${instance.instanceId}/delivery`)
      .set('Cookie', context.cookie).expect(409);

    const started = await request(context.app).post('/api/runner/start').set(runnerAuth).send({}).expect(200);
    const questionId = (started.body as { questions: Array<{ id: string }> }).questions[0]?.id as string;
    await request(context.app).put(`/api/runner/answers/${questionId}`).set(runnerAuth)
      .send({ value: 'isolated', idempotencyKey: 'runner-save-0001' }).expect(200);
    await request(context.app).post('/api/runner/register').set(runnerAuth)
      .send({ gradioUrl: 'https://example.gradio.live/' }).expect(200);
    await request(context.app).post('/api/runner/heartbeat').set(runnerAuth).send({}).expect(200);
    const ready = await request(context.app).get(`/api/test-instances/${instance.instanceId}/delivery`)
      .set('Cookie', context.cookie).expect(200);
    expect((ready.body as { state: string }).state).toBe('READY');

    const stored = await context.database<{ attempt_id: string; gradio_password_hash: string }>('deployments')
      .where({ attempt_id: instance.attemptId }).first();
    expect(stored?.gradio_password_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.gradio_password_hash).not.toContain(exchanged.gradioPassword);

    const relaunchToken = await request(context.app).post(`/api/test-instances/${instance.instanceId}/runner-token`)
      .set('Cookie', context.cookie).set('X-CSRF-Token', context.csrf).send({}).expect(201);
    await request(context.app).get('/api/runner/manifest').set(runnerAuth).expect(200);
    const secondExchange = await request(context.app).post('/api/runner/exchange')
      .send({ runnerToken: (relaunchToken.body as { runnerToken: string }).runnerToken }).expect(201);
    const secondCredential = (secondExchange.body as { runnerCredential: string; generation: number }).runnerCredential;
    expect((secondExchange.body as { generation: number }).generation).toBe(2);
    await request(context.app).get('/api/runner/manifest').set(runnerAuth).expect(401);
    const recovered = await request(context.app).get('/api/runner/manifest')
      .set(candidateAuth(secondCredential)).expect(200);
    expect((recovered.body as { questions: Array<{ answer: string }> }).questions[0]?.answer).toBe('isolated');
    await request(context.app).post('/api/runner/register').set(candidateAuth(secondCredential))
      .send({ gradioUrl: 'https://replacement.gradio.live/' }).expect(200);
    await context.database('deployments').where({ attempt_id: instance.attemptId, generation: 2 })
      .update({ last_heartbeat_at: new Date(Date.now() - 3_600_000).toISOString() });
    const offline = await request(context.app).get(`/api/test-instances/${instance.instanceId}/deployment`)
      .set('Cookie', context.cookie).expect(200);
    expect((offline.body as { deployment: { state: string } }).deployment.state).toBe('OFFLINE');
  });

  it('keeps an active runner credential alive while the runner continues calling the API', async () => {
    const context = await setupPublishedTemplate();
    const instance = await createInstance(context, 'LongRunner', 'COLAB_GRADIO');
    const exchange = await request(context.app).post('/api/runner/exchange')
      .send({ runnerToken: instance.runnerToken }).expect(201);
    const runnerAuth = candidateAuth((exchange.body as { runnerCredential: string }).runnerCredential);
    await context.database('deployments').where({ attempt_id: instance.attemptId })
      .update({ credential_expires_at: new Date(Date.now() + 1000).toISOString() });
    await request(context.app).post('/api/runner/heartbeat').set(runnerAuth).send({}).expect(200);
    const refreshed = await context.database<{ credential_expires_at: string }>('deployments')
      .where('attempt_id', instance.attemptId).first();
    expect(new Date(refreshed?.credential_expires_at as string).getTime()).toBeGreaterThan(Date.now() + 60_000);
    await request(context.app).get('/api/runner/manifest').set(runnerAuth).expect(200);
  });
});
