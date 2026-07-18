import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { writeAudit } from '../audit/service.js';
import type { AuthContext } from '../auth/service.js';
import { fromJson, nowIso, toJson } from '../domain/types.js';
import { HttpError } from '../http/errors.js';

interface ResultHeaderRow {
  attempt_id: string;
  state: string;
  started_at: string | null;
  deadline_at: string | null;
  submitted_at: string | null;
  created_at: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  template_id: string;
  template_title: string;
  domain: string;
  delivery_mode: string;
}

interface ResultQuestionRow {
  id: string;
  test_instance_id: string;
  position: number;
  section_key: string;
  title: string;
  prompt: string;
  type: string;
  maximum_score: number | string;
  score_weight: number | string;
  choices_json: string;
  answer_key_json: string;
  scoring_rubric: string;
}

interface ResultAnswerRow {
  id: string;
  attempt_id: string;
  instance_question_id: string;
  answer_json: string;
  saved_at: string;
}

interface ScoreRow {
  id: string;
  attempt_id?: string;
  answer_id: string;
  kind: string;
  score: number | string;
  maximum_score: number | string;
  revision: number;
  reviewer_user_id: string | null;
  reason: string;
  created_at: string;
}

interface EventRow {
  id: string;
  attempt_id: string;
  type: string;
  details_json: string;
  created_at: string;
}

interface CommentRow {
  id: string;
  instance_question_id: string | null;
  comment: string;
  created_at: string;
  reviewer_email: string;
}

export interface ResultFilters {
  candidate?: string | undefined;
  templateId?: string | undefined;
  domain?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

async function headerQuery(database: Knex, filters: ResultFilters = {}): Promise<ResultHeaderRow[]> {
  let query = database('candidate_attempts as attempts')
    .join('test_instances as instances', 'instances.id', 'attempts.test_instance_id')
    .join('candidates', 'candidates.id', 'instances.candidate_id')
    .join('test_template_versions as templates', 'templates.id', 'instances.template_version_id')
    .select<ResultHeaderRow[]>(
      'attempts.id as attempt_id', 'attempts.state', 'attempts.started_at', 'attempts.deadline_at',
      'attempts.submitted_at', 'attempts.created_at', 'candidates.id as candidate_id',
      'candidates.name as candidate_name', 'candidates.email as candidate_email',
      'templates.template_id', 'templates.title as template_title', 'templates.domain', 'instances.delivery_mode',
    );
  if (filters.candidate) query = query.where((builder) => builder
    .whereILike('candidates.name', `%${filters.candidate}%`).orWhereILike('candidates.email', `%${filters.candidate}%`));
  if (filters.templateId) query = query.where('templates.template_id', filters.templateId);
  if (filters.domain) query = query.where('templates.domain', filters.domain);
  if (filters.status) query = query.where('attempts.state', filters.status);
  if (filters.from) query = query.where('attempts.created_at', '>=', filters.from);
  if (filters.to) query = query.where('attempts.created_at', '<=', filters.to);
  return query.orderBy('attempts.created_at', 'desc');
}

function latestScores(rows: ScoreRow[]): Map<string, ScoreRow> {
  const latest = new Map<string, ScoreRow>();
  for (const score of rows) {
    const current = latest.get(score.answer_id);
    if (!current || score.revision > current.revision) latest.set(score.answer_id, score);
  }
  return latest;
}

async function totals(database: Knex, attemptId: string): Promise<{ score: number; maximumScore: number; scoredAnswers: number }> {
  const scores = await database<ScoreRow>('scores').where({ attempt_id: attemptId });
  const latest = [...latestScores(scores).values()];
  return {
    score: latest.reduce((sum, item) => sum + Number(item.score), 0),
    maximumScore: latest.reduce((sum, item) => sum + Number(item.maximum_score), 0),
    scoredAnswers: latest.length,
  };
}

export async function listResults(database: Knex, filters: ResultFilters = {}) {
  const rows = await headerQuery(database, filters);
  return Promise.all(rows.map(async (row) => ({
    attemptId: row.attempt_id,
    state: row.state,
    candidate: { id: row.candidate_id, name: row.candidate_name, email: row.candidate_email },
    template: { id: row.template_id, title: row.template_title, domain: row.domain },
    deliveryMode: row.delivery_mode,
    startedAt: row.started_at,
    deadlineAt: row.deadline_at,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    ...await totals(database, row.attempt_id),
  })));
}

export async function getResult(database: Knex, attemptId: string) {
  const header = (await headerQuery(database)).find((row) => row.attempt_id === attemptId);
  if (!header) throw new HttpError(404, 'RESULT_NOT_FOUND', 'Attempt result was not found');
  const instance = await database<{ id: string; test_instance_id: string }>('candidate_attempts')
    .where({ id: attemptId }).first('test_instance_id');
  if (!instance) throw new HttpError(404, 'RESULT_NOT_FOUND', 'Attempt result was not found');
  const questions = await database<ResultQuestionRow>('test_instance_questions')
    .where({ test_instance_id: instance.test_instance_id }).orderBy('position');
  const answers = await database<ResultAnswerRow>('answers').where({ attempt_id: attemptId });
  const scores = await database<ScoreRow>('scores').where({ attempt_id: attemptId }).orderBy(['answer_id', { column: 'revision', order: 'asc' }]);
  const answerByQuestion = new Map(answers.map((answer) => [answer.instance_question_id, answer]));
  const scoresByAnswer = new Map<string, ScoreRow[]>();
  for (const score of scores) scoresByAnswer.set(score.answer_id, [...(scoresByAnswer.get(score.answer_id) ?? []), score]);
  const events = await database<EventRow>('attempt_events').where({ attempt_id: attemptId })
    .select<EventRow[]>('id', 'type', 'details_json', 'created_at').orderBy('created_at');
  const comments = await database('review_comments as comments').join('users', 'users.id', 'comments.reviewer_user_id')
    .where('comments.attempt_id', attemptId)
    .select<CommentRow[]>('comments.id', 'comments.instance_question_id', 'comments.comment', 'comments.created_at', 'users.email as reviewer_email')
    .orderBy('comments.created_at');
  return {
    attemptId,
    state: header.state,
    candidate: { id: header.candidate_id, name: header.candidate_name, email: header.candidate_email },
    template: { id: header.template_id, title: header.template_title, domain: header.domain },
    deliveryMode: header.delivery_mode,
    startedAt: header.started_at,
    deadlineAt: header.deadline_at,
    submittedAt: header.submitted_at,
    ...await totals(database, attemptId),
    questions: questions.map((question) => {
      const answer = answerByQuestion.get(question.id);
      return {
        id: question.id, position: question.position, sectionKey: question.section_key, title: question.title,
        prompt: question.prompt, type: question.type,
        maximumScore: Number(question.maximum_score) * Number(question.score_weight),
        choices: fromJson<unknown[]>(question.choices_json, []),
        answerKey: fromJson<Record<string, unknown>>(question.answer_key_json, {}),
        scoringRubric: question.scoring_rubric,
        answer: answer ? fromJson<unknown>(answer.answer_json, null) : null,
        answerId: answer?.id ?? null,
        savedAt: answer?.saved_at ?? null,
        scores: answer ? (scoresByAnswer.get(answer.id) ?? []).map(mapScore) : [],
      };
    }),
    events: events.map((event) => ({
      id: event.id, type: event.type,
      details: fromJson<Record<string, unknown>>(event.details_json, {}), createdAt: event.created_at,
    })),
    comments: comments.map((comment) => ({
      id: comment.id, questionId: comment.instance_question_id,
      comment: comment.comment, reviewerEmail: comment.reviewer_email, createdAt: comment.created_at,
    })),
  };
}

function mapScore(score: ScoreRow) {
  return {
    id: score.id, kind: score.kind, score: Number(score.score), maximumScore: Number(score.maximum_score),
    revision: score.revision, reviewerUserId: score.reviewer_user_id, reason: score.reason, createdAt: score.created_at,
  };
}

export async function addManualScore(
  database: Knex,
  input: { attemptId: string; answerId: string; score: number; reason: string },
  auth: AuthContext,
  requestId?: string,
): Promise<ReturnType<typeof mapScore>> {
  return database.transaction(async (transaction) => {
    const attempt = await transaction<{ id: string; state: string }>('candidate_attempts').where({ id: input.attemptId }).first();
    if (!attempt) throw new HttpError(404, 'RESULT_NOT_FOUND', 'Attempt result was not found');
    if (attempt.state !== 'SUBMITTED') throw new HttpError(409, 'ATTEMPT_NOT_SUBMITTED', 'Only submitted attempts can be scored');
    const answer = await transaction('answers as answers')
      .join('test_instance_questions as questions', 'questions.id', 'answers.instance_question_id')
      .where('answers.id', input.answerId).where('answers.attempt_id', input.attemptId)
      .select<{ id: string; maximum_score: number | string; score_weight: number | string }[]>(
        'answers.id', 'questions.maximum_score', 'questions.score_weight',
      ).first();
    if (!answer) throw new HttpError(404, 'ANSWER_NOT_FOUND', 'Answer was not found in this attempt');
    const maximum = Number(answer.maximum_score) * Number(answer.score_weight);
    if (input.score < 0 || input.score > maximum) {
      throw new HttpError(400, 'SCORE_OUT_OF_RANGE', `Score must be between 0 and ${maximum}`);
    }
    const existing = await transaction<ScoreRow>('scores').where({ answer_id: input.answerId }).orderBy('revision', 'desc').first();
    const row: ScoreRow = {
      id: randomUUID(), answer_id: input.answerId, kind: existing ? 'OVERRIDE' : 'MANUAL',
      score: input.score, maximum_score: maximum, revision: (existing?.revision ?? 0) + 1,
      reviewer_user_id: auth.user.id, reason: input.reason, created_at: nowIso(),
    };
    await transaction('scores').insert({ ...row, attempt_id: input.attemptId });
    await transaction('attempt_events').insert({
      id: randomUUID(), attempt_id: input.attemptId, type: existing ? 'SCORE_OVERRIDDEN' : 'MANUAL_SCORE_ADDED',
      details_json: toJson({ answerId: input.answerId, revision: row.revision }), created_at: row.created_at,
    });
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: existing ? 'SCORE_OVERRIDDEN' : 'MANUAL_SCORE_ADDED',
      targetType: 'ANSWER', targetId: input.answerId, requestId,
      details: { attemptId: input.attemptId, revision: row.revision, score: input.score, maximum },
    });
    return mapScore(row);
  });
}

export async function addReviewComment(
  database: Knex,
  input: { attemptId: string; questionId?: string | undefined; comment: string },
  auth: AuthContext,
  requestId?: string,
): Promise<{ id: string; createdAt: string }> {
  const attempt = await database<{ id: string; state: string }>('candidate_attempts').where({ id: input.attemptId }).first();
  if (!attempt) throw new HttpError(404, 'RESULT_NOT_FOUND', 'Attempt result was not found');
  if (input.questionId) {
    const belongs: unknown = await database('test_instance_questions as questions')
      .join('test_instances as instances', 'instances.id', 'questions.test_instance_id')
      .join('candidate_attempts as attempts', 'attempts.test_instance_id', 'instances.id')
      .where('questions.id', input.questionId).where('attempts.id', input.attemptId).first('questions.id');
    if (!belongs) throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Question was not found in this attempt');
  }
  const id = randomUUID();
  const createdAt = nowIso();
  await database.transaction(async (transaction) => {
    await transaction('review_comments').insert({
      id, attempt_id: input.attemptId, instance_question_id: input.questionId ?? null,
      reviewer_user_id: auth.user.id, comment: input.comment, created_at: createdAt,
    });
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'REVIEW_COMMENT_ADDED', targetType: 'CANDIDATE_ATTEMPT',
      targetId: input.attemptId, requestId, details: { questionId: input.questionId },
    });
  });
  return { id, createdAt };
}

export function resultsToCsv(results: Awaited<ReturnType<typeof listResults>>): string {
  const escape = (value: unknown) => {
    const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
    return `"${scalar.replace(/"/g, '""')}"`;
  };
  const headers = ['attemptId', 'candidateName', 'candidateEmail', 'templateTitle', 'domain', 'state', 'score', 'maximumScore', 'submittedAt'];
  const lines = results.map((result) => [
    result.attemptId, result.candidate.name, result.candidate.email, result.template.title, result.template.domain,
    result.state, result.score, result.maximumScore, result.submittedAt,
  ].map(escape).join(','));
  return [headers.map(escape).join(','), ...lines].join('\r\n');
}
