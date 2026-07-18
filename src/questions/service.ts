import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { writeAudit } from '../audit/service.js';
import { fromJson, nowIso, toJson } from '../domain/types.js';
import { assertActiveDomain } from '../domains/service.js';
import { HttpError } from '../http/errors.js';
import type { AuthContext } from '../auth/service.js';
import type { QuestionInput } from './schemas.js';

export interface QuestionVersionRow {
  id: string;
  question_id: string;
  version: number;
  status: string;
  title: string;
  description: string;
  prompt: string;
  domain: string;
  type: string;
  difficulty: string;
  expected_duration_minutes: number;
  maximum_score: number | string;
  choices_json: string;
  answer_key_json: string;
  scoring_rubric: string;
  created_by_user_id: string;
  created_at: string;
  published_at: string | null;
}

interface QuestionRow {
  id: string;
  author_user_id: string;
  status: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

function versionRecord(id: string, questionId: string, version: number, input: QuestionInput, actorId: string, timestamp: string) {
  return {
    id,
    question_id: questionId,
    version,
    status: 'DRAFT',
    title: input.title,
    description: input.description,
    prompt: input.prompt,
    domain: input.domain,
    type: input.type,
    difficulty: input.difficulty,
    expected_duration_minutes: input.expectedDurationMinutes,
    maximum_score: input.maximumScore,
    choices_json: toJson(input.choices),
    answer_key_json: toJson(input.answerKey),
    scoring_rubric: input.scoringRubric,
    created_by_user_id: actorId,
    created_at: timestamp,
    published_at: null,
  };
}

async function replaceTags(transaction: Knex.Transaction, questionId: string, tags: string[], timestamp: string): Promise<void> {
  await transaction('question_tags').where({ question_id: questionId }).delete();
  for (const name of [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]) {
    const normalized = name.toLocaleLowerCase('en-US');
    const tag = await transaction<{ id: string; normalized_name: string }>('tags').where({ normalized_name: normalized }).first();
    const tagId = tag?.id ?? randomUUID();
    if (!tag) await transaction('tags').insert({ id: tagId, name, normalized_name: normalized, created_at: timestamp });
    await transaction('question_tags').insert({ question_id: questionId, tag_id: tagId });
  }
}

export async function createQuestion(database: Knex, input: QuestionInput, auth: AuthContext, requestId?: string): Promise<string> {
  await assertActiveDomain(database, input.domain);
  const questionId = randomUUID();
  const versionId = randomUUID();
  const timestamp = nowIso();
  await database.transaction(async (transaction) => {
    await transaction('questions').insert({
      id: questionId, author_user_id: auth.user.id, status: 'DRAFT', current_version: 1,
      created_at: timestamp, updated_at: timestamp,
    });
    await transaction('question_versions').insert(versionRecord(versionId, questionId, 1, input, auth.user.id, timestamp));
    await replaceTags(transaction, questionId, input.tags, timestamp);
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'QUESTION_CREATED', targetType: 'QUESTION', targetId: questionId,
      requestId, details: { version: 1, type: input.type, domain: input.domain },
    });
  });
  return questionId;
}

export async function updateQuestion(
  database: Knex, questionId: string, input: QuestionInput, auth: AuthContext, requestId?: string,
): Promise<number> {
  await assertActiveDomain(database, input.domain);
  return database.transaction(async (transaction) => {
    const question = await transaction<QuestionRow>('questions').where({ id: questionId }).first();
    if (!question) throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Question was not found');
    if (question.status === 'ARCHIVED') throw new HttpError(409, 'QUESTION_ARCHIVED', 'Archived questions cannot be edited');
    const current = await transaction<QuestionVersionRow>('question_versions')
      .where({ question_id: questionId, version: question.current_version }).first();
    if (!current) throw new HttpError(500, 'QUESTION_VERSION_MISSING', 'Current question version is missing');
    const timestamp = nowIso();
    let version = question.current_version;
    if (current.status === 'DRAFT') {
      const replacement = versionRecord(current.id, questionId, version, input, auth.user.id, timestamp);
      await transaction('question_versions').where({ id: current.id }).update(replacement);
    } else {
      version += 1;
      await transaction('question_versions').insert(versionRecord(randomUUID(), questionId, version, input, auth.user.id, timestamp));
    }
    await transaction('questions').where({ id: questionId }).update({ current_version: version, status: 'DRAFT', updated_at: timestamp });
    await replaceTags(transaction, questionId, input.tags, timestamp);
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'QUESTION_UPDATED', targetType: 'QUESTION', targetId: questionId,
      requestId, details: { version },
    });
    return version;
  });
}

export async function publishQuestion(database: Knex, questionId: string, auth: AuthContext, requestId?: string): Promise<number> {
  return database.transaction(async (transaction) => {
    const question = await transaction<QuestionRow>('questions').where({ id: questionId }).first();
    if (!question) throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Question was not found');
    if (question.status === 'ARCHIVED') throw new HttpError(409, 'QUESTION_ARCHIVED', 'Archived questions cannot be published');
    const current = await transaction<QuestionVersionRow>('question_versions')
      .where({ question_id: questionId, version: question.current_version }).first();
    if (!current) throw new HttpError(500, 'QUESTION_VERSION_MISSING', 'Current question version is missing');
    if (current.status === 'PUBLISHED') return question.current_version;
    const timestamp = nowIso();
    await transaction('question_versions').where({ id: current.id }).update({ status: 'PUBLISHED', published_at: timestamp });
    await transaction('questions').where({ id: questionId }).update({ status: 'PUBLISHED', updated_at: timestamp });
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'QUESTION_PUBLISHED', targetType: 'QUESTION', targetId: questionId,
      requestId, details: { version: question.current_version },
    });
    return question.current_version;
  });
}

export async function archiveQuestion(database: Knex, questionId: string, auth: AuthContext, requestId?: string): Promise<void> {
  const updated = await database('questions').where({ id: questionId }).update({ status: 'ARCHIVED', updated_at: nowIso() });
  if (!updated) throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Question was not found');
  await writeAudit(database, {
    actorUserId: auth.user.id, action: 'QUESTION_ARCHIVED', targetType: 'QUESTION', targetId: questionId, requestId,
  });
}

export function mapQuestionVersion(row: QuestionVersionRow, tags: string[] = []) {
  return {
    id: row.question_id,
    versionId: row.id,
    version: row.version,
    status: row.status,
    title: row.title,
    description: row.description,
    prompt: row.prompt,
    domain: row.domain,
    type: row.type,
    difficulty: row.difficulty,
    expectedDurationMinutes: row.expected_duration_minutes,
    maximumScore: Number(row.maximum_score),
    choices: fromJson<unknown[]>(row.choices_json, []),
    answerKey: fromJson<Record<string, unknown>>(row.answer_key_json, {}),
    scoringRubric: row.scoring_rubric,
    tags,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

export async function getQuestion(database: Knex, questionId: string): Promise<ReturnType<typeof mapQuestionVersion>> {
  const question = await database<QuestionRow>('questions').where({ id: questionId }).first();
  if (!question) throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Question was not found');
  const version = await database<QuestionVersionRow>('question_versions')
    .where({ question_id: questionId, version: question.current_version }).first();
  if (!version) throw new HttpError(500, 'QUESTION_VERSION_MISSING', 'Current question version is missing');
  const tags = await database('question_tags').join('tags', 'tags.id', 'question_tags.tag_id')
    .where('question_tags.question_id', questionId).orderBy('tags.name').pluck<string[]>('tags.name');
  return { ...mapQuestionVersion(version, tags), status: question.status };
}

export async function duplicateQuestion(database: Knex, questionId: string, auth: AuthContext, requestId?: string): Promise<string> {
  const source = await getQuestion(database, questionId);
  return createQuestion(database, {
    title: `${source.title} (copy)`, description: source.description, prompt: source.prompt,
    domain: source.domain, type: source.type as QuestionInput['type'],
    difficulty: source.difficulty as QuestionInput['difficulty'],
    expectedDurationMinutes: source.expectedDurationMinutes, maximumScore: source.maximumScore,
    choices: source.choices as QuestionInput['choices'], answerKey: source.answerKey as QuestionInput['answerKey'],
    scoringRubric: source.scoringRubric, tags: source.tags,
  }, auth, requestId);
}
