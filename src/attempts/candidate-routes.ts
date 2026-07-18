import { Router, type RequestHandler } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { HttpError } from '../http/errors.js';
import {
  candidateManifest, resolveCandidate, saveAnswer, startAttempt, submitAttempt, type CandidateContext,
} from './service.js';

function getCandidate(response: Parameters<RequestHandler>[1]): CandidateContext {
  const context = response.locals.candidate as CandidateContext | undefined;
  if (!context) throw new HttpError(401, 'CANDIDATE_TOKEN_REQUIRED', 'A candidate token is required');
  return context;
}

export function requireCandidate(database: Knex): RequestHandler {
  return async (request, response, next) => {
    try {
      const authorization = request.header('authorization');
      const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      if (!token) throw new HttpError(401, 'CANDIDATE_TOKEN_REQUIRED', 'A candidate token is required');
      response.locals.candidate = await resolveCandidate(database, token);
      next();
    } catch (error) {
      next(error);
    }
  };
}

const saveSchema = z.object({
  value: z.unknown(),
  idempotencyKey: z.string().min(8).max(100),
}).strict();

const submitSchema = z.object({ idempotencyKey: z.string().min(8).max(100) }).strict();

export function createCandidateRouter(database: Knex): Router {
  const router = Router();
  router.use(requireCandidate(database));
  router.get('/attempt', async (_request, response, next) => {
    try {
      response.json(await candidateManifest(database, getCandidate(response)));
    } catch (error) {
      next(error);
    }
  });
  router.post('/start', async (_request, response, next) => {
    try {
      const context = await startAttempt(database, getCandidate(response));
      response.json(await candidateManifest(database, context));
    } catch (error) {
      next(error);
    }
  });
  router.put('/answers/:questionId', async (request, response, next) => {
    try {
      const questionId = z.string().uuid().parse(request.params.questionId);
      const input = saveSchema.parse(request.body);
      response.json(await saveAnswer(database, getCandidate(response), questionId, input.value, input.idempotencyKey));
    } catch (error) {
      next(error);
    }
  });
  router.post('/submit', async (request, response, next) => {
    try {
      const input = submitSchema.parse(request.body);
      response.json(await submitAttempt(database, getCandidate(response), input.idempotencyKey));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
