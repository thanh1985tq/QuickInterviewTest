import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import { lifecycleStatuses, questionTypes } from '../domain/types.js';
import { domainSlugSchema } from '../domains/schemas.js';
import {
  archiveQuestion, createQuestion, duplicateQuestion, getQuestion, mapQuestionVersion,
  publishQuestion, type QuestionVersionRow, updateQuestion,
} from './service.js';
import { questionInputSchema } from './schemas.js';
import { exportQuestionBank, importQuestionBank } from '../portability/service.js';

interface QuestionListRow extends QuestionVersionRow {
  entity_status: string;
  updated_at: string;
}

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  domain: domainSlugSchema.optional(),
  type: z.enum(questionTypes).optional(),
  status: z.enum(lifecycleStatuses).optional(),
  tag: z.string().trim().max(100).optional(),
}).strict();

export function createQuestionsRouter(database: Knex): Router {
  const router = Router();
  router.get('/export.json', async (_request, response, next) => {
    try {
      response.setHeader('Content-Disposition', 'attachment; filename="quick-interview-question-bank.json"');
      response.json(await exportQuestionBank(database));
    } catch (error) {
      next(error);
    }
  });
  router.post('/import', async (request, response, next) => {
    try {
      const input = z.object({ dryRun: z.boolean().default(true), document: z.unknown() }).strict().parse(request.body);
      response.json(await importQuestionBank(
        database, input.document, input.dryRun, getAuth(response), response.locals.requestId as string | undefined,
      ));
    } catch (error) {
      next(error);
    }
  });
  router.get('/', async (request, response, next) => {
    try {
      const filters = listSchema.parse(request.query);
      let query = database('questions as questions')
        .join('question_versions as versions', function joinCurrent() {
          this.on('versions.question_id', 'questions.id').andOn('versions.version', 'questions.current_version');
        })
        .select<QuestionListRow[]>('versions.*', 'questions.status as entity_status', 'questions.updated_at');
      if (filters.search) query = query.where((builder) => builder
        .whereILike('versions.title', `%${filters.search}%`)
        .orWhereILike('versions.description', `%${filters.search}%`));
      if (filters.domain) query = query.where('versions.domain', filters.domain);
      if (filters.type) query = query.where('versions.type', filters.type);
      if (filters.status) query = query.where('questions.status', filters.status);
      if (filters.tag) query = query.whereExists(function hasTag() {
        this.select(database.raw('1')).from('question_tags')
          .join('tags', 'tags.id', 'question_tags.tag_id')
          .whereRaw('question_tags.question_id = questions.id')
          .where('tags.normalized_name', filters.tag?.toLocaleLowerCase('en-US') ?? '');
      });
      const rows = await query.orderBy('questions.updated_at', 'desc');
      const questions = await Promise.all(rows.map(async (row) => {
        const tags = await database('question_tags').join('tags', 'tags.id', 'question_tags.tag_id')
          .where('question_tags.question_id', row.question_id).orderBy('tags.name').pluck<string[]>('tags.name');
        return { ...mapQuestionVersion(row, tags), status: row.entity_status, updatedAt: row.updated_at };
      }));
      response.json({ questions });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    try {
      const id = await createQuestion(
        database, questionInputSchema.parse(request.body), getAuth(response), response.locals.requestId as string | undefined,
      );
      response.status(201).json(await getQuestion(database, id));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:questionId', async (request, response, next) => {
    try {
      response.json(await getQuestion(database, z.string().uuid().parse(request.params.questionId)));
    } catch (error) {
      next(error);
    }
  });

  router.put('/:questionId', async (request, response, next) => {
    try {
      const questionId = z.string().uuid().parse(request.params.questionId);
      await updateQuestion(
        database, questionId, questionInputSchema.parse(request.body), getAuth(response),
        response.locals.requestId as string | undefined,
      );
      response.json(await getQuestion(database, questionId));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:questionId/publish', async (request, response, next) => {
    try {
      const questionId = z.string().uuid().parse(request.params.questionId);
      const version = await publishQuestion(database, questionId, getAuth(response), response.locals.requestId as string | undefined);
      response.json({ id: questionId, version, status: 'PUBLISHED' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:questionId/archive', async (request, response, next) => {
    try {
      const questionId = z.string().uuid().parse(request.params.questionId);
      await archiveQuestion(database, questionId, getAuth(response), response.locals.requestId as string | undefined);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:questionId', async (request, response, next) => {
    try {
      const questionId = z.string().uuid().parse(request.params.questionId);
      await archiveQuestion(database, questionId, getAuth(response), response.locals.requestId as string | undefined);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/:questionId/duplicate', async (request, response, next) => {
    try {
      const id = await duplicateQuestion(
        database, z.string().uuid().parse(request.params.questionId), getAuth(response),
        response.locals.requestId as string | undefined,
      );
      response.status(201).json(await getQuestion(database, id));
    } catch (error) {
      next(error);
    }
  });

  router.get('/:questionId/versions', async (request, response, next) => {
    try {
      const questionId = z.string().uuid().parse(request.params.questionId);
      const rows = await database<QuestionVersionRow>('question_versions')
        .where({ question_id: questionId }).orderBy('version', 'desc');
      response.json({ versions: rows.map((row) => mapQuestionVersion(row)) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
