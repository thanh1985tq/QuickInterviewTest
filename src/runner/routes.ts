import { Router, type RequestHandler } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { HttpError } from '../http/errors.js';
import { candidateManifest, saveAnswer, startAttempt, submitAttempt } from '../attempts/service.js';
import {
  exchangeRunnerToken, heartbeat, registerDeployment, resolveRunner, type RunnerContext,
} from './service.js';

function getRunner(response: Parameters<RequestHandler>[1]): RunnerContext {
  const context = response.locals.runner as RunnerContext | undefined;
  if (!context) throw new HttpError(401, 'RUNNER_CREDENTIAL_REQUIRED', 'A runner credential is required');
  return context;
}

function requireRunner(database: Knex, config: AppConfig): RequestHandler {
  return async (request, response, next) => {
    try {
      const authorization = request.header('authorization');
      const credential = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      if (!credential) throw new HttpError(401, 'RUNNER_CREDENTIAL_REQUIRED', 'A runner credential is required');
      response.locals.runner = await resolveRunner(database, config, credential);
      next();
    } catch (error) {
      next(error);
    }
  };
}

const exchangeSchema = z.object({ runnerToken: z.string().min(32).max(200) }).strict();
const registerSchema = z.object({ gradioUrl: z.string().url().max(2000) }).strict();
const saveSchema = z.object({ value: z.unknown(), idempotencyKey: z.string().min(8).max(100) }).strict();
const submitSchema = z.object({ idempotencyKey: z.string().min(8).max(100) }).strict();

export function createRunnerRouter(database: Knex, config: AppConfig): Router {
  const router = Router();
  router.post('/exchange', async (request, response, next) => {
    try {
      const { runnerToken } = exchangeSchema.parse(request.body);
      response.status(201).json({
        runnerVersion: '1.0.0',
        ...await exchangeRunnerToken(database, config, runnerToken),
      });
    } catch (error) {
      next(error);
    }
  });
  router.use(requireRunner(database, config));
  router.get('/manifest', async (_request, response, next) => {
    try {
      response.json(await candidateManifest(database, getRunner(response).candidate));
    } catch (error) {
      next(error);
    }
  });
  router.post('/start', async (_request, response, next) => {
    try {
      const runner = getRunner(response);
      runner.candidate = await startAttempt(database, runner.candidate);
      response.json(await candidateManifest(database, runner.candidate));
    } catch (error) {
      next(error);
    }
  });
  router.post('/register', async (request, response, next) => {
    try {
      const { gradioUrl } = registerSchema.parse(request.body);
      await registerDeployment(database, getRunner(response), gradioUrl);
      response.json({ state: 'READY' });
    } catch (error) {
      next(error);
    }
  });
  router.post('/heartbeat', async (_request, response, next) => {
    try {
      response.json({ state: 'READY', serverNow: await heartbeat(database, getRunner(response)) });
    } catch (error) {
      next(error);
    }
  });
  router.put('/answers/:questionId', async (request, response, next) => {
    try {
      const questionId = z.string().uuid().parse(request.params.questionId);
      const input = saveSchema.parse(request.body);
      response.json(await saveAnswer(database, getRunner(response).candidate, questionId, input.value, input.idempotencyKey));
    } catch (error) {
      next(error);
    }
  });
  router.post('/submit', async (request, response, next) => {
    try {
      const runner = getRunner(response);
      const input = submitSchema.parse(request.body);
      const result = await submitAttempt(database, runner.candidate, input.idempotencyKey);
      await database('deployments').where({ id: runner.deployment.id }).update({ state: 'CLOSED', closed_at: new Date().toISOString() });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
