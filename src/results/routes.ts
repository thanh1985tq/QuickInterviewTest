import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import { attemptStates } from '../domain/types.js';
import { domainSlugSchema } from '../domains/schemas.js';
import {
  addManualScore, addReviewComment, getResult, listResults, resultsToCsv, type ResultFilters,
} from './service.js';

const filtersSchema = z.object({
  candidate: z.string().trim().max(300).optional(),
  templateId: z.string().uuid().optional(),
  domain: domainSlugSchema.optional(),
  status: z.enum(attemptStates).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
}).strict();

const scoreSchema = z.object({
  answerId: z.string().uuid(),
  score: z.number().min(0).max(100_000),
  reason: z.string().trim().min(1).max(5000),
}).strict();

const commentSchema = z.object({
  questionId: z.string().uuid().optional(),
  comment: z.string().trim().min(1).max(10_000),
}).strict();

export function createResultsRouter(database: Knex): Router {
  const router = Router();
  const parseFilters = (query: unknown): ResultFilters => filtersSchema.parse(query);

  router.get('/', async (request, response, next) => {
    try {
      response.json({ results: await listResults(database, parseFilters(request.query)) });
    } catch (error) {
      next(error);
    }
  });
  router.get('/export.json', async (request, response, next) => {
    try {
      response.setHeader('Content-Disposition', 'attachment; filename="quick-interview-results.json"');
      response.json({ exportedAt: new Date().toISOString(), results: await listResults(database, parseFilters(request.query)) });
    } catch (error) {
      next(error);
    }
  });
  router.get('/export.csv', async (request, response, next) => {
    try {
      const csv = resultsToCsv(await listResults(database, parseFilters(request.query)));
      response.type('text/csv').setHeader('Content-Disposition', 'attachment; filename="quick-interview-results.csv"');
      response.send(csv);
    } catch (error) {
      next(error);
    }
  });
  router.get('/:attemptId', async (request, response, next) => {
    try {
      response.json(await getResult(database, z.string().uuid().parse(request.params.attemptId)));
    } catch (error) {
      next(error);
    }
  });
  router.post('/:attemptId/scores', async (request, response, next) => {
    try {
      const attemptId = z.string().uuid().parse(request.params.attemptId);
      const input = scoreSchema.parse(request.body);
      response.status(201).json(await addManualScore(
        database, { attemptId, ...input }, getAuth(response), response.locals.requestId as string | undefined,
      ));
    } catch (error) {
      next(error);
    }
  });
  router.post('/:attemptId/comments', async (request, response, next) => {
    try {
      const attemptId = z.string().uuid().parse(request.params.attemptId);
      const input = commentSchema.parse(request.body);
      response.status(201).json(await addReviewComment(
        database, { attemptId, ...input }, getAuth(response), response.locals.requestId as string | undefined,
      ));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
