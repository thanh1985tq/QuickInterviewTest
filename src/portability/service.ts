import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import type { AuthContext } from '../auth/service.js';
import { fromJson, lifecycleStatuses, nowIso, toJson } from '../domain/types.js';
import { HttpError } from '../http/errors.js';
import { questionInputSchema, type QuestionInput } from '../questions/schemas.js';
import type { QuestionVersionRow } from '../questions/service.js';
import { templateInputSchema, type TemplateInput } from '../templates/schemas.js';
import type { TemplateQuestionRow, TemplateVersionRow } from '../templates/service.js';

const questionVersionImportSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(lifecycleStatuses),
  publishedAt: z.string().nullable(),
  data: questionInputSchema,
}).strict();

const questionImportSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(lifecycleStatuses),
  currentVersion: z.number().int().positive(),
  versions: z.array(questionVersionImportSchema).min(1),
}).strict();

export const questionBankDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('quick-interview-question-bank'),
  exportedAt: z.string(),
  questions: z.array(questionImportSchema).max(10_000),
}).strict();

const templateVersionImportSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(lifecycleStatuses),
  publishedAt: z.string().nullable(),
  data: templateInputSchema,
}).strict();

const templateImportSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(lifecycleStatuses),
  currentVersion: z.number().int().positive(),
  versions: z.array(templateVersionImportSchema).min(1),
}).strict();

export const templatesDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('quick-interview-templates'),
  exportedAt: z.string(),
  templates: z.array(templateImportSchema).max(10_000),
}).strict();

export interface ImportConflict {
  type: 'DUPLICATE_ID' | 'VERSION_CONFLICT' | 'INVALID_CURRENT_VERSION' | 'MISSING_QUESTION_VERSION';
  id: string;
  message: string;
}

interface QuestionEntityRow {
  id: string;
  status: string;
  current_version: number;
}

interface TemplateEntityRow {
  id: string;
  status: string;
  current_version: number;
}

function mapVersionData(row: QuestionVersionRow, tags: string[]): QuestionInput {
  return questionInputSchema.parse({
    title: row.title, description: row.description, prompt: row.prompt, domain: row.domain, type: row.type,
    difficulty: row.difficulty, expectedDurationMinutes: row.expected_duration_minutes,
    maximumScore: Number(row.maximum_score), choices: fromJson<unknown[]>(row.choices_json, []),
    answerKey: fromJson<Record<string, unknown>>(row.answer_key_json, {}), scoringRubric: row.scoring_rubric, tags,
  });
}

export async function exportQuestionBank(database: Knex) {
  const entities = await database<QuestionEntityRow>('questions').orderBy('created_at');
  return {
    schemaVersion: 1 as const,
    kind: 'quick-interview-question-bank' as const,
    exportedAt: nowIso(),
    questions: await Promise.all(entities.map(async (entity) => {
      const versions = await database<QuestionVersionRow>('question_versions')
        .where({ question_id: entity.id }).orderBy('version');
      const tags = await database('question_tags').join('tags', 'tags.id', 'question_tags.tag_id')
        .where('question_tags.question_id', entity.id).orderBy('tags.name').pluck<string[]>('tags.name');
      return {
        id: entity.id, status: entity.status, currentVersion: entity.current_version,
        versions: versions.map((version) => ({
          id: version.id, version: version.version, status: version.status,
          publishedAt: version.published_at, data: mapVersionData(version, tags),
        })),
      };
    })),
  };
}

async function questionConflicts(database: Knex, document: z.infer<typeof questionBankDocumentSchema>): Promise<ImportConflict[]> {
  const conflicts: ImportConflict[] = [];
  const seenEntities = new Set<string>();
  const seenVersions = new Set<string>();
  for (const question of document.questions) {
    if (seenEntities.has(question.id) || await database('questions').where({ id: question.id }).first('id')) {
      conflicts.push({ type: 'DUPLICATE_ID', id: question.id, message: 'Question ID already exists or is duplicated in the document' });
    }
    seenEntities.add(question.id);
    if (!question.versions.some((version) => version.version === question.currentVersion)) {
      conflicts.push({ type: 'INVALID_CURRENT_VERSION', id: question.id, message: 'Current question version is not included' });
    }
    const versionNumbers = new Set<number>();
    for (const version of question.versions) {
      if (seenVersions.has(version.id) || versionNumbers.has(version.version)
        || await database('question_versions').where({ id: version.id }).first('id')) {
        conflicts.push({ type: 'VERSION_CONFLICT', id: version.id, message: 'Question version ID or number conflicts' });
      }
      seenVersions.add(version.id);
      versionNumbers.add(version.version);
    }
  }
  return conflicts;
}

async function importTags(transaction: Knex.Transaction, questionId: string, tags: string[], timestamp: string): Promise<void> {
  for (const name of [...new Set(tags)]) {
    const normalized = name.toLocaleLowerCase('en-US');
    const existing: unknown = await transaction('tags').where({ normalized_name: normalized }).first('id');
    const existingId = existing && typeof existing === 'object' && 'id' in existing ? String(existing.id) : undefined;
    const tagId = existingId ?? randomUUID();
    if (!existingId) await transaction('tags').insert({ id: tagId, name, normalized_name: normalized, created_at: timestamp });
    await transaction('question_tags').insert({ question_id: questionId, tag_id: tagId });
  }
}

export async function importQuestionBank(
  database: Knex, rawDocument: unknown, dryRun: boolean, auth: AuthContext, requestId?: string,
): Promise<{ dryRun: boolean; imported: number; conflicts: ImportConflict[] }> {
  const document = questionBankDocumentSchema.parse(rawDocument);
  const conflicts = await questionConflicts(database, document);
  if (dryRun) return { dryRun: true, imported: 0, conflicts };
  if (conflicts.length) throw new HttpError(409, 'IMPORT_CONFLICT', 'Question import has conflicts', conflicts);
  const timestamp = nowIso();
  await database.transaction(async (transaction) => {
    for (const question of document.questions) {
      await transaction('questions').insert({
        id: question.id, author_user_id: auth.user.id, status: question.status,
        current_version: question.currentVersion, created_at: timestamp, updated_at: timestamp,
      });
      for (const version of question.versions) {
        const data = version.data;
        await transaction('question_versions').insert({
          id: version.id, question_id: question.id, version: version.version, status: version.status,
          title: data.title, description: data.description, prompt: data.prompt, domain: data.domain,
          type: data.type, difficulty: data.difficulty, expected_duration_minutes: data.expectedDurationMinutes,
          maximum_score: data.maximumScore, choices_json: toJson(data.choices), answer_key_json: toJson(data.answerKey),
          scoring_rubric: data.scoringRubric, created_by_user_id: auth.user.id, created_at: timestamp,
          published_at: version.publishedAt,
        });
      }
      await importTags(transaction, question.id, question.versions[0]?.data.tags ?? [], timestamp);
    }
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'QUESTION_BANK_IMPORTED', targetType: 'QUESTION_BANK',
      requestId, details: { count: document.questions.length },
    });
  });
  return { dryRun: false, imported: document.questions.length, conflicts: [] };
}

async function mapTemplateData(database: Knex, version: TemplateVersionRow): Promise<TemplateInput> {
  const references = await database<TemplateQuestionRow>('test_template_questions')
    .where({ template_version_id: version.id }).orderBy('position');
  return templateInputSchema.parse({
    title: version.title, description: version.description, domain: version.domain,
    targetSeniority: version.target_seniority, durationMinutes: version.duration_minutes,
    randomizeQuestions: Boolean(version.randomize_questions), selectionMode: version.selection_mode,
    sections: fromJson<unknown[]>(version.sections_json, []), navigation: fromJson<Record<string, unknown>>(version.navigation_json, {}),
    questions: references.map((reference) => ({
      questionVersionId: reference.question_version_id, sectionKey: reference.section_key,
      position: reference.position, scoreWeight: Number(reference.score_weight), required: Boolean(reference.required),
    })),
  });
}

export async function exportTemplates(database: Knex) {
  const entities = await database<TemplateEntityRow>('test_templates').orderBy('created_at');
  return {
    schemaVersion: 1 as const,
    kind: 'quick-interview-templates' as const,
    exportedAt: nowIso(),
    templates: await Promise.all(entities.map(async (entity) => {
      const versions = await database<TemplateVersionRow>('test_template_versions')
        .where({ template_id: entity.id }).orderBy('version');
      return {
        id: entity.id, status: entity.status, currentVersion: entity.current_version,
        versions: await Promise.all(versions.map(async (version) => ({
          id: version.id, version: version.version, status: version.status,
          publishedAt: version.published_at, data: await mapTemplateData(database, version),
        }))),
      };
    })),
  };
}

async function templateConflicts(database: Knex, document: z.infer<typeof templatesDocumentSchema>): Promise<ImportConflict[]> {
  const conflicts: ImportConflict[] = [];
  const seenEntities = new Set<string>();
  const seenVersions = new Set<string>();
  for (const template of document.templates) {
    if (seenEntities.has(template.id) || await database('test_templates').where({ id: template.id }).first('id')) {
      conflicts.push({ type: 'DUPLICATE_ID', id: template.id, message: 'Template ID already exists or is duplicated in the document' });
    }
    seenEntities.add(template.id);
    if (!template.versions.some((version) => version.version === template.currentVersion)) {
      conflicts.push({ type: 'INVALID_CURRENT_VERSION', id: template.id, message: 'Current template version is not included' });
    }
    const numbers = new Set<number>();
    for (const version of template.versions) {
      if (seenVersions.has(version.id) || numbers.has(version.version)
        || await database('test_template_versions').where({ id: version.id }).first('id')) {
        conflicts.push({ type: 'VERSION_CONFLICT', id: version.id, message: 'Template version ID or number conflicts' });
      }
      seenVersions.add(version.id);
      numbers.add(version.version);
      for (const question of version.data.questions) {
        const exists: unknown = await database('question_versions')
          .where({ id: question.questionVersionId, status: 'PUBLISHED' }).first('id');
        if (!exists) conflicts.push({
          type: 'MISSING_QUESTION_VERSION', id: question.questionVersionId,
          message: 'Referenced published question version is missing',
        });
      }
    }
  }
  return conflicts;
}

export async function importTemplates(
  database: Knex, rawDocument: unknown, dryRun: boolean, auth: AuthContext, requestId?: string,
): Promise<{ dryRun: boolean; imported: number; conflicts: ImportConflict[] }> {
  const document = templatesDocumentSchema.parse(rawDocument);
  const conflicts = await templateConflicts(database, document);
  if (dryRun) return { dryRun: true, imported: 0, conflicts };
  if (conflicts.length) throw new HttpError(409, 'IMPORT_CONFLICT', 'Template import has conflicts', conflicts);
  const timestamp = nowIso();
  await database.transaction(async (transaction) => {
    for (const template of document.templates) {
      await transaction('test_templates').insert({
        id: template.id, author_user_id: auth.user.id, status: template.status,
        current_version: template.currentVersion, created_at: timestamp, updated_at: timestamp,
      });
      for (const version of template.versions) {
        const data = version.data;
        await transaction('test_template_versions').insert({
          id: version.id, template_id: template.id, version: version.version, status: version.status,
          title: data.title, description: data.description, domain: data.domain,
          target_seniority: data.targetSeniority, duration_minutes: data.durationMinutes,
          randomize_questions: data.randomizeQuestions, selection_mode: data.selectionMode,
          sections_json: toJson(data.sections), navigation_json: toJson(data.navigation),
          created_by_user_id: auth.user.id, created_at: timestamp, published_at: version.publishedAt,
        });
        await transaction('test_template_questions').insert(data.questions.map((question) => ({
          id: randomUUID(), template_version_id: version.id, question_version_id: question.questionVersionId,
          section_key: question.sectionKey, position: question.position,
          score_weight: question.scoreWeight, required: question.required,
        })));
      }
    }
    await writeAudit(transaction, {
      actorUserId: auth.user.id, action: 'TEMPLATES_IMPORTED', targetType: 'TEST_TEMPLATE_COLLECTION',
      requestId, details: { count: document.templates.length },
    });
  });
  return { dryRun: false, imported: document.templates.length, conflicts: [] };
}
