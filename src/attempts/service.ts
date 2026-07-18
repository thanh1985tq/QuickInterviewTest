import { randomInt, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { AppConfig } from '../config.js';
import { writeAudit } from '../audit/service.js';
import type { AuthContext } from '../auth/service.js';
import { fromJson, nowIso, toJson, type AttemptState, type DeliveryMode } from '../domain/types.js';
import { HttpError } from '../http/errors.js';
import type { QuestionVersionRow } from '../questions/service.js';
import { hashToken, randomToken } from '../security/crypto.js';
import { scoreObjectiveAnswers } from '../results/scoring.js';
import type { TemplateQuestionRow, TemplateVersionRow } from '../templates/service.js';

interface TemplateEntityRow {
  id: string;
  status: string;
  current_version: number;
}

interface CandidateRow {
  id: string;
  name: string;
  email: string | null;
  metadata_json: string;
}

export interface AttemptRow {
  id: string;
  test_instance_id: string;
  state: AttemptState;
  candidate_token_hash: string;
  token_expires_at: string;
  started_at: string | null;
  deadline_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface InstanceRow {
  id: string;
  template_version_id: string;
  candidate_id: string;
  created_by_user_id: string;
  delivery_mode: DeliveryMode;
  available_from: string;
  available_until: string;
  duration_minutes: number;
  configuration_json: string;
  created_at: string;
}

export interface InstanceQuestionRow {
  id: string;
  test_instance_id: string;
  source_question_version_id: string;
  position: number;
  section_key: string;
  title: string;
  description: string;
  prompt: string;
  domain: string;
  type: string;
  maximum_score: number | string;
  score_weight: number | string;
  required: boolean | number;
  choices_json: string;
  answer_key_json: string;
  scoring_rubric: string;
}

interface AnswerRow {
  id: string;
  attempt_id: string;
  instance_question_id: string;
  answer_json: string;
  idempotency_key: string;
  saved_at: string;
}

export interface CandidateContext {
  attempt: AttemptRow;
  instance: InstanceRow;
  candidate: CandidateRow;
  template: TemplateVersionRow;
}

export interface CreateInstanceInput {
  templateId: string;
  candidate: { id?: string | undefined; name?: string | undefined; email?: string | null | undefined };
  deliveryMode: DeliveryMode;
  availableFrom: string;
  availableUntil: string;
  durationMinutes?: number | undefined;
}

function shuffled<T>(values: T[]): T[] {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [output[index], output[swap]] = [output[swap] as T, output[index] as T];
  }
  return output;
}

export async function createTestInstance(
  database: Knex, config: AppConfig, input: CreateInstanceInput, auth: AuthContext, requestId?: string,
): Promise<{
  instanceId: string;
  attemptId: string;
  candidateToken: string;
  candidateUrl: string;
  tokenExpiresAt: string;
  runnerToken?: string;
  runnerTokenExpiresAt?: string;
}> {
  const from = new Date(input.availableFrom);
  const until = new Date(input.availableUntil);
  if (!(from < until)) throw new HttpError(400, 'AVAILABILITY_INVALID', 'Availability end must be after its start');

  const templateEntity = await database<TemplateEntityRow>('test_templates').where({ id: input.templateId }).first();
  if (!templateEntity || templateEntity.status !== 'PUBLISHED') {
    throw new HttpError(400, 'TEMPLATE_NOT_PUBLISHED', 'A published template is required');
  }
  const template = await database<TemplateVersionRow>('test_template_versions')
    .where({ template_id: input.templateId, version: templateEntity.current_version, status: 'PUBLISHED' }).first();
  if (!template) throw new HttpError(400, 'TEMPLATE_NOT_PUBLISHED', 'A published template version is required');
  const durationMinutes = input.durationMinutes ?? template.duration_minutes;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > template.duration_minutes) {
    throw new HttpError(400, 'DURATION_INVALID', `Duration must be between 1 and ${template.duration_minutes} minutes`);
  }

  const references = await database<TemplateQuestionRow>('test_template_questions')
    .where({ template_version_id: template.id }).orderBy('position');
  if (references.length === 0) throw new HttpError(400, 'TEMPLATE_EMPTY', 'The template has no questions');
  const versions = await database<QuestionVersionRow>('question_versions')
    .whereIn('id', references.map((reference) => reference.question_version_id));
  const byId = new Map(versions.map((version) => [version.id, version]));
  const ordered = template.randomize_questions ? shuffled(references) : references;

  const instanceId = randomUUID();
  const attemptId = randomUUID();
  const candidateToken = randomToken();
  const runnerToken = input.deliveryMode === 'COLAB_GRADIO' ? randomToken() : undefined;
  const runnerTokenExpiresAt = runnerToken
    ? new Date(Date.now() + config.runnerTokenTtlMinutes * 60_000).toISOString()
    : undefined;
  const createdAt = nowIso();
  const configuredExpiry = new Date(Date.now() + config.candidateTokenTtlMinutes * 60_000);
  const tokenExpiresAt = new Date(Math.min(until.getTime(), configuredExpiry.getTime())).toISOString();
  let candidateId = input.candidate.id;

  await database.transaction(async (transaction) => {
    if (candidateId) {
      const candidate = await transaction<CandidateRow>('candidates').where({ id: candidateId }).first();
      if (!candidate) throw new HttpError(404, 'CANDIDATE_NOT_FOUND', 'Candidate was not found');
    } else {
      if (!input.candidate.name?.trim()) throw new HttpError(400, 'CANDIDATE_NAME_REQUIRED', 'Candidate name is required');
      candidateId = randomUUID();
      await transaction('candidates').insert({
        id: candidateId, name: input.candidate.name.trim(), email: input.candidate.email?.trim().toLocaleLowerCase('en-US') || null,
        metadata_json: '{}', anonymized_at: null, created_at: createdAt, updated_at: createdAt,
      });
    }
    await transaction('test_instances').insert({
      id: instanceId, template_version_id: template.id, candidate_id: candidateId,
      created_by_user_id: auth.user.id, delivery_mode: input.deliveryMode,
      available_from: from.toISOString(), available_until: until.toISOString(), duration_minutes: durationMinutes,
      configuration_json: toJson({ templateVersion: template.version }), created_at: createdAt,
    });
    for (const [index, reference] of ordered.entries()) {
      const version = byId.get(reference.question_version_id);
      if (!version) throw new HttpError(500, 'TEMPLATE_QUESTION_MISSING', 'A template question version is missing');
      await transaction('test_instance_questions').insert({
        id: randomUUID(), test_instance_id: instanceId, source_question_version_id: version.id,
        position: index + 1, section_key: reference.section_key, title: version.title,
        description: version.description, prompt: version.prompt, domain: version.domain, type: version.type,
        maximum_score: version.maximum_score, score_weight: reference.score_weight, required: reference.required,
        choices_json: version.choices_json, answer_key_json: version.answer_key_json,
        scoring_rubric: version.scoring_rubric,
      });
    }
    await transaction('candidate_attempts').insert({
      id: attemptId, test_instance_id: instanceId, state: 'INVITED', candidate_token_hash: hashToken(candidateToken),
      token_expires_at: tokenExpiresAt, started_at: null, deadline_at: null, submitted_at: null,
      created_at: createdAt, updated_at: createdAt,
    });
    if (runnerToken && runnerTokenExpiresAt) await transaction('runner_tokens').insert({
      id: randomUUID(), attempt_id: attemptId, token_hash: hashToken(runnerToken), expires_at: runnerTokenExpiresAt,
      consumed_at: null, created_at: createdAt,
    });
    await transaction('attempt_events').insert({
      id: randomUUID(), attempt_id: attemptId, type: 'INVITED', details_json: toJson({ deliveryMode: input.deliveryMode }), created_at: createdAt,
    });
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'TEST_INSTANCE_CREATED', targetType: 'TEST_INSTANCE', targetId: instanceId,
      requestId, details: { attemptId, deliveryMode: input.deliveryMode, candidateId },
    });
  });
  return {
    instanceId, attemptId, candidateToken,
    candidateUrl: `${config.baseUrl}/test/${encodeURIComponent(candidateToken)}`,
    tokenExpiresAt,
    ...(runnerToken && runnerTokenExpiresAt ? { runnerToken, runnerTokenExpiresAt } : {}),
  };
}

export async function getCandidateContextByAttemptId(database: Knex, attemptId: string): Promise<CandidateContext> {
  const attempt = await database<AttemptRow>('candidate_attempts').where({ id: attemptId }).first();
  if (!attempt) throw new HttpError(404, 'ATTEMPT_NOT_FOUND', 'Candidate attempt was not found');
  const instance = await database<InstanceRow>('test_instances').where({ id: attempt.test_instance_id }).first();
  if (!instance) throw new HttpError(500, 'ATTEMPT_DATA_MISSING', 'Attempt data is incomplete');
  const candidate = await database<CandidateRow>('candidates').where({ id: instance.candidate_id }).first();
  const template = await database<TemplateVersionRow>('test_template_versions').where({ id: instance.template_version_id }).first();
  if (!candidate || !template) throw new HttpError(500, 'ATTEMPT_DATA_MISSING', 'Attempt data is incomplete');
  return { attempt, instance, candidate, template };
}

export async function resolveCandidate(database: Knex, token: string): Promise<CandidateContext> {
  const attempt = await database<AttemptRow>('candidate_attempts').where({ candidate_token_hash: hashToken(token) }).first();
  if (!attempt) throw new HttpError(404, 'CANDIDATE_LINK_INVALID', 'Candidate link is invalid');
  if (new Date(attempt.token_expires_at).getTime() <= Date.now()) {
    throw new HttpError(410, 'CANDIDATE_LINK_EXPIRED', 'Candidate link has expired');
  }
  const instance = await database<InstanceRow>('test_instances').where({ id: attempt.test_instance_id }).first();
  if (!instance) throw new HttpError(404, 'CANDIDATE_LINK_INVALID', 'Candidate link is invalid');
  if (attempt.state !== 'SUBMITTED' && attempt.state !== 'CANCELLED') {
    const effectiveEnd = Math.min(
      new Date(instance.available_until).getTime(),
      attempt.deadline_at ? new Date(attempt.deadline_at).getTime() : Number.POSITIVE_INFINITY,
    );
    if (effectiveEnd <= Date.now()) {
      const timestamp = nowIso();
      await database('candidate_attempts').where({ id: attempt.id }).update({ state: 'EXPIRED', updated_at: timestamp });
      attempt.state = 'EXPIRED';
      attempt.updated_at = timestamp;
    }
  }
  const candidate = await database<CandidateRow>('candidates').where({ id: instance.candidate_id }).first();
  const template = await database<TemplateVersionRow>('test_template_versions').where({ id: instance.template_version_id }).first();
  if (!candidate || !template) throw new HttpError(500, 'ATTEMPT_DATA_MISSING', 'Attempt data is incomplete');
  return { attempt, instance, candidate, template };
}

export async function startAttempt(database: Knex, context: CandidateContext): Promise<CandidateContext> {
  const { attempt, instance } = context;
  if (attempt.state === 'SUBMITTED') throw new HttpError(409, 'ATTEMPT_SUBMITTED', 'This attempt is already submitted');
  if (attempt.state === 'EXPIRED') throw new HttpError(410, 'ATTEMPT_EXPIRED', 'This attempt has expired');
  if (attempt.state === 'CANCELLED') throw new HttpError(410, 'ATTEMPT_CANCELLED', 'This attempt was cancelled');
  if (new Date(instance.available_from).getTime() > Date.now()) {
    throw new HttpError(403, 'ATTEMPT_NOT_AVAILABLE', 'This attempt is not available yet');
  }
  if (attempt.started_at) return context;
  const startedAt = nowIso();
  const deadlineAt = new Date(Math.min(
    Date.now() + instance.duration_minutes * 60_000,
    new Date(instance.available_until).getTime(),
  )).toISOString();
  const started = await database.transaction(async (transaction) => {
    const updated = await transaction('candidate_attempts').where({ id: attempt.id, started_at: null }).update({
      state: 'STARTED', started_at: startedAt, deadline_at: deadlineAt, updated_at: startedAt,
    });
    if (updated) await transaction('attempt_events').insert({
      id: randomUUID(), attempt_id: attempt.id, type: 'STARTED', details_json: '{}', created_at: startedAt,
    });
    return Boolean(updated);
  });
  if (!started) {
    const current = await database<AttemptRow>('candidate_attempts').where({ id: attempt.id }).first();
    if (!current) throw new HttpError(404, 'ATTEMPT_NOT_FOUND', 'Candidate attempt was not found');
    context.attempt = current;
    return context;
  }
  attempt.state = 'STARTED';
  attempt.started_at = startedAt;
  attempt.deadline_at = deadlineAt;
  attempt.updated_at = startedAt;
  return context;
}

function assertWritable(context: CandidateContext): void {
  if (!context.attempt.started_at) throw new HttpError(409, 'ATTEMPT_NOT_STARTED', 'Start the attempt before saving answers');
  if (context.attempt.state === 'SUBMITTED') throw new HttpError(409, 'ATTEMPT_SUBMITTED', 'Submitted answers are locked');
  if (context.attempt.state === 'EXPIRED') throw new HttpError(410, 'ATTEMPT_EXPIRED', 'This attempt has expired');
  if (context.attempt.state === 'CANCELLED') throw new HttpError(410, 'ATTEMPT_CANCELLED', 'This attempt was cancelled');
  if (!context.attempt.deadline_at || new Date(context.attempt.deadline_at).getTime() <= Date.now()) {
    throw new HttpError(410, 'ATTEMPT_EXPIRED', 'This attempt has expired');
  }
}

function validateAnswer(question: InstanceQuestionRow, value: unknown): void {
  const choices = fromJson<{ id: string }[]>(question.choices_json, []);
  const choiceIds = new Set(choices.map((choice) => choice.id));
  if (question.type === 'SINGLE_CHOICE') {
    if (typeof value !== 'string' || !choiceIds.has(value)) throw new HttpError(400, 'ANSWER_INVALID', 'Select one available choice');
  } else if (question.type === 'MULTIPLE_CHOICE') {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !choiceIds.has(entry)) || new Set(value).size !== value.length) {
      throw new HttpError(400, 'ANSWER_INVALID', 'Select only unique available choices');
    }
  } else if (typeof value !== 'string' || value.length > 50_000) {
    throw new HttpError(400, 'ANSWER_INVALID', 'Answer must be text of at most 50,000 characters');
  }
}

export async function saveAnswer(
  database: Knex, context: CandidateContext, questionId: string, value: unknown, idempotencyKey: string,
): Promise<{ savedAt: string; idempotent: boolean }> {
  assertWritable(context);
  const question = await database<InstanceQuestionRow>('test_instance_questions')
    .where({ id: questionId, test_instance_id: context.instance.id }).first();
  if (!question) throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Question is not part of this attempt');
  validateAnswer(question, value);
  const serialized = toJson(value);
  if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) throw new HttpError(413, 'ANSWER_TOO_LARGE', 'Answer exceeds the size limit');
  const existing = await database<AnswerRow>('answers')
    .where({ attempt_id: context.attempt.id, instance_question_id: questionId }).first();
  if (existing?.idempotency_key === idempotencyKey) return { savedAt: existing.saved_at, idempotent: true };
  const savedAt = nowIso();
  await database.transaction(async (transaction) => {
    await transaction('answers').insert({
      id: existing?.id ?? randomUUID(), attempt_id: context.attempt.id, instance_question_id: questionId,
      answer_json: serialized, idempotency_key: idempotencyKey, saved_at: savedAt,
    }).onConflict(['attempt_id', 'instance_question_id']).merge({
      answer_json: serialized, idempotency_key: idempotencyKey, saved_at: savedAt,
    });
    if (context.attempt.state === 'STARTED') {
      await transaction('candidate_attempts').where({ id: context.attempt.id }).update({ state: 'IN_PROGRESS', updated_at: savedAt });
    }
  });
  return { savedAt, idempotent: false };
}

export async function submitAttempt(database: Knex, context: CandidateContext, idempotencyKey: string): Promise<{ submittedAt: string; idempotent: boolean }> {
  if (context.attempt.state === 'SUBMITTED' && context.attempt.submitted_at) {
    return { submittedAt: context.attempt.submitted_at, idempotent: true };
  }
  assertWritable(context);
  const required = await database<InstanceQuestionRow>('test_instance_questions')
    .where({ test_instance_id: context.instance.id, required: true });
  const answered = await database<AnswerRow>('answers').where({ attempt_id: context.attempt.id }).pluck<string[]>('instance_question_id');
  const answeredIds = new Set(answered);
  const missing = required.filter((question) => !answeredIds.has(question.id)).map((question) => question.id);
  if (missing.length) throw new HttpError(400, 'REQUIRED_ANSWERS_MISSING', 'Answer all required questions before submitting', { questionIds: missing });
  const submittedAt = nowIso();
  const submitted = await database.transaction(async (transaction) => {
    const updated = await transaction('candidate_attempts')
      .where({ id: context.attempt.id }).whereNot({ state: 'SUBMITTED' })
      .update({ state: 'SUBMITTED', submitted_at: submittedAt, updated_at: submittedAt });
    if (updated) await transaction('attempt_events').insert({
      id: randomUUID(), attempt_id: context.attempt.id, type: 'SUBMITTED',
      details_json: toJson({ idempotencyKey }), created_at: submittedAt,
    });
    if (updated) await scoreObjectiveAnswers(transaction, context.attempt.id);
    return Boolean(updated);
  });
  if (!submitted) {
    const current = await database<AttemptRow>('candidate_attempts').where({ id: context.attempt.id }).first();
    if (current?.state === 'SUBMITTED' && current.submitted_at) {
      return { submittedAt: current.submitted_at, idempotent: true };
    }
  }
  return { submittedAt, idempotent: false };
}

export async function candidateManifest(database: Knex, context: CandidateContext) {
  const questions = await database<InstanceQuestionRow>('test_instance_questions')
    .where({ test_instance_id: context.instance.id }).orderBy('position');
  const answers = await database<AnswerRow>('answers').where({ attempt_id: context.attempt.id });
  const byQuestion = new Map(answers.map((answer) => [answer.instance_question_id, answer]));
  return {
    candidate: { name: context.candidate.name },
    test: {
      title: context.template.title,
      description: context.template.description,
      durationMinutes: context.instance.duration_minutes,
      deliveryMode: context.instance.delivery_mode,
      availableFrom: context.instance.available_from,
      availableUntil: context.instance.available_until,
    },
    attempt: {
      state: context.attempt.state,
      startedAt: context.attempt.started_at,
      deadlineAt: context.attempt.deadline_at,
      submittedAt: context.attempt.submitted_at,
      serverNow: nowIso(),
    },
    questions: questions.map((question) => ({
      id: question.id, position: question.position, sectionKey: question.section_key,
      title: question.title, description: question.description, prompt: question.prompt,
      type: question.type, maximumScore: Number(question.maximum_score) * Number(question.score_weight),
      required: Boolean(question.required), choices: fromJson<unknown[]>(question.choices_json, []),
      answer: byQuestion.has(question.id) ? fromJson<unknown>(byQuestion.get(question.id)?.answer_json, null) : null,
      savedAt: byQuestion.get(question.id)?.saved_at ?? null,
    })),
  };
}
