import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { writeAudit } from '../audit/service.js';
import type { AuthContext } from '../auth/service.js';
import { fromJson, nowIso, toJson } from '../domain/types.js';
import { HttpError } from '../http/errors.js';
import type { QuestionVersionRow } from '../questions/service.js';
import type { TemplateInput } from './schemas.js';

interface TemplateRow {
  id: string;
  author_user_id: string;
  status: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersionRow {
  id: string;
  template_id: string;
  version: number;
  status: string;
  title: string;
  description: string;
  domain: string;
  target_seniority: string;
  duration_minutes: number;
  randomize_questions: boolean | number;
  selection_mode: string;
  sections_json: string;
  navigation_json: string;
  created_by_user_id: string;
  created_at: string;
  published_at: string | null;
}

export interface TemplateQuestionRow {
  id: string;
  template_version_id: string;
  question_version_id: string;
  section_key: string;
  position: number;
  score_weight: number | string;
  required: boolean | number;
}

function versionRecord(id: string, templateId: string, version: number, input: TemplateInput, actorId: string, timestamp: string) {
  return {
    id,
    template_id: templateId,
    version,
    status: 'DRAFT',
    title: input.title,
    description: input.description,
    domain: input.domain,
    target_seniority: input.targetSeniority,
    duration_minutes: input.durationMinutes,
    randomize_questions: input.randomizeQuestions,
    selection_mode: input.selectionMode,
    sections_json: toJson(input.sections),
    navigation_json: toJson(input.navigation),
    created_by_user_id: actorId,
    created_at: timestamp,
    published_at: null,
  };
}

async function validateQuestions(database: Knex | Knex.Transaction, input: TemplateInput): Promise<void> {
  const rows = await database<QuestionVersionRow>('question_versions').whereIn(
    'id', input.questions.map((question) => question.questionVersionId),
  );
  if (rows.length !== input.questions.length) {
    throw new HttpError(400, 'TEMPLATE_QUESTION_MISSING', 'One or more question versions do not exist');
  }
  if (rows.some((row) => row.status !== 'PUBLISHED')) {
    throw new HttpError(400, 'TEMPLATE_QUESTION_UNPUBLISHED', 'Templates can use only published question versions');
  }
  if (rows.some((row) => row.domain !== input.domain)) {
    throw new HttpError(400, 'TEMPLATE_DOMAIN_MISMATCH', 'Every question must match the template domain');
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const section of input.sections) {
    const declared = section.maximumScore;
    if (declared === undefined) continue;
    const computed = input.questions
      .filter((question) => question.sectionKey === section.key)
      .reduce((sum, question) => sum + Number(byId.get(question.questionVersionId)?.maximum_score ?? 0) * question.scoreWeight, 0);
    if (Math.abs(computed - declared) > 0.005) {
      throw new HttpError(400, 'TEMPLATE_SECTION_SCORE_INVALID', `Section ${section.key} maximum score must equal ${computed}`);
    }
  }
}

async function replaceTemplateQuestions(transaction: Knex.Transaction, templateVersionId: string, input: TemplateInput): Promise<void> {
  await transaction('test_template_questions').where({ template_version_id: templateVersionId }).delete();
  await transaction('test_template_questions').insert(input.questions.map((question) => ({
    id: randomUUID(),
    template_version_id: templateVersionId,
    question_version_id: question.questionVersionId,
    section_key: question.sectionKey,
    position: question.position,
    score_weight: question.scoreWeight,
    required: question.required,
  })));
}

export async function createTemplate(database: Knex, input: TemplateInput, auth: AuthContext, requestId?: string): Promise<string> {
  await validateQuestions(database, input);
  const templateId = randomUUID();
  const versionId = randomUUID();
  const timestamp = nowIso();
  await database.transaction(async (transaction) => {
    await transaction('test_templates').insert({
      id: templateId, author_user_id: auth.user.id, status: 'DRAFT', current_version: 1,
      created_at: timestamp, updated_at: timestamp,
    });
    await transaction('test_template_versions').insert(versionRecord(versionId, templateId, 1, input, auth.user.id, timestamp));
    await replaceTemplateQuestions(transaction, versionId, input);
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'TEMPLATE_CREATED', targetType: 'TEST_TEMPLATE', targetId: templateId,
      requestId, details: { version: 1, questionCount: input.questions.length },
    });
  });
  return templateId;
}

export async function updateTemplate(
  database: Knex, templateId: string, input: TemplateInput, auth: AuthContext, requestId?: string,
): Promise<number> {
  await validateQuestions(database, input);
  return database.transaction(async (transaction) => {
    const template = await transaction<TemplateRow>('test_templates').where({ id: templateId }).first();
    if (!template) throw new HttpError(404, 'TEMPLATE_NOT_FOUND', 'Test template was not found');
    if (template.status === 'ARCHIVED') throw new HttpError(409, 'TEMPLATE_ARCHIVED', 'Archived templates cannot be edited');
    const current = await transaction<TemplateVersionRow>('test_template_versions')
      .where({ template_id: templateId, version: template.current_version }).first();
    if (!current) throw new HttpError(500, 'TEMPLATE_VERSION_MISSING', 'Current template version is missing');
    const timestamp = nowIso();
    let version = template.current_version;
    let versionId = current.id;
    if (current.status === 'DRAFT') {
      await transaction('test_template_versions').where({ id: current.id })
        .update(versionRecord(current.id, templateId, version, input, auth.user.id, timestamp));
    } else {
      version += 1;
      versionId = randomUUID();
      await transaction('test_template_versions').insert(versionRecord(versionId, templateId, version, input, auth.user.id, timestamp));
    }
    await replaceTemplateQuestions(transaction, versionId, input);
    await transaction('test_templates').where({ id: templateId })
      .update({ current_version: version, status: 'DRAFT', updated_at: timestamp });
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'TEMPLATE_UPDATED', targetType: 'TEST_TEMPLATE', targetId: templateId,
      requestId, details: { version, questionCount: input.questions.length },
    });
    return version;
  });
}

export async function publishTemplate(database: Knex, templateId: string, auth: AuthContext, requestId?: string): Promise<number> {
  return database.transaction(async (transaction) => {
    const template = await transaction<TemplateRow>('test_templates').where({ id: templateId }).first();
    if (!template) throw new HttpError(404, 'TEMPLATE_NOT_FOUND', 'Test template was not found');
    if (template.status === 'ARCHIVED') throw new HttpError(409, 'TEMPLATE_ARCHIVED', 'Archived templates cannot be published');
    const current = await transaction<TemplateVersionRow>('test_template_versions')
      .where({ template_id: templateId, version: template.current_version }).first();
    if (!current) throw new HttpError(500, 'TEMPLATE_VERSION_MISSING', 'Current template version is missing');
    const count = await transaction('test_template_questions').where({ template_version_id: current.id }).count<{ count: number | string }[]>({ count: '*' });
    if (Number(count[0]?.count ?? 0) === 0) throw new HttpError(400, 'TEMPLATE_EMPTY', 'A template must contain at least one question');
    if (current.status !== 'PUBLISHED') {
      const timestamp = nowIso();
      await transaction('test_template_versions').where({ id: current.id }).update({ status: 'PUBLISHED', published_at: timestamp });
      await transaction('test_templates').where({ id: templateId }).update({ status: 'PUBLISHED', updated_at: timestamp });
      await writeAudit(transaction, {
        actorUserId: auth.user.id, action: 'TEMPLATE_PUBLISHED', targetType: 'TEST_TEMPLATE', targetId: templateId,
        requestId, details: { version: template.current_version },
      });
    }
    return template.current_version;
  });
}

export async function getTemplate(database: Knex, templateId: string) {
  const template = await database<TemplateRow>('test_templates').where({ id: templateId }).first();
  if (!template) throw new HttpError(404, 'TEMPLATE_NOT_FOUND', 'Test template was not found');
  const version = await database<TemplateVersionRow>('test_template_versions')
    .where({ template_id: templateId, version: template.current_version }).first();
  if (!version) throw new HttpError(500, 'TEMPLATE_VERSION_MISSING', 'Current template version is missing');
  const questions = await database<TemplateQuestionRow>('test_template_questions')
    .where({ template_version_id: version.id }).orderBy('position');
  return mapTemplateVersion(version, questions, template.status);
}

export function mapTemplateVersion(version: TemplateVersionRow, questions: TemplateQuestionRow[], entityStatus = version.status) {
  return {
    id: version.template_id,
    versionId: version.id,
    version: version.version,
    status: entityStatus,
    title: version.title,
    description: version.description,
    domain: version.domain,
    targetSeniority: version.target_seniority,
    durationMinutes: version.duration_minutes,
    randomizeQuestions: Boolean(version.randomize_questions),
    selectionMode: version.selection_mode,
    sections: fromJson<unknown[]>(version.sections_json, []),
    navigation: fromJson<Record<string, unknown>>(version.navigation_json, {}),
    questions: questions.map((question) => ({
      questionVersionId: question.question_version_id,
      sectionKey: question.section_key,
      position: question.position,
      scoreWeight: Number(question.score_weight),
      required: Boolean(question.required),
    })),
    createdAt: version.created_at,
    publishedAt: version.published_at,
  };
}

export async function previewTemplate(database: Knex, templateId: string) {
  const template = await getTemplate(database, templateId);
  const questionIds = template.questions.map((question) => question.questionVersionId);
  const rows = await database<QuestionVersionRow>('question_versions').whereIn('id', questionIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    ...template,
    questions: template.questions.map((reference) => {
      const question = byId.get(reference.questionVersionId);
      if (!question) throw new HttpError(500, 'TEMPLATE_QUESTION_MISSING', 'Template question is missing');
      return {
        ...reference, title: question.title, description: question.description, prompt: question.prompt,
        type: question.type, maximumScore: Number(question.maximum_score),
        choices: fromJson<unknown[]>(question.choices_json, []),
      };
    }),
  };
}

export async function archiveTemplate(database: Knex, templateId: string, auth: AuthContext, requestId?: string): Promise<void> {
  const updated = await database('test_templates').where({ id: templateId }).update({ status: 'ARCHIVED', updated_at: nowIso() });
  if (!updated) throw new HttpError(404, 'TEMPLATE_NOT_FOUND', 'Test template was not found');
  await writeAudit(database, {
    actorUserId: auth.user.id, action: 'TEMPLATE_ARCHIVED', targetType: 'TEST_TEMPLATE', targetId: templateId, requestId,
  });
}
