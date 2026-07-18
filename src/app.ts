import { resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express, type Request, type RequestHandler, type Response } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { rateLimit } from 'express-rate-limit';
import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { createAdminUsersRouter } from './admin/users.js';
import { createTestInstancesRouter } from './attempts/admin-routes.js';
import { createCandidateRouter } from './attempts/candidate-routes.js';
import { resolveCandidate } from './attempts/service.js';
import { requireAuth, requireCsrfForMutations, requirePasswordChangeResolved } from './auth/middleware.js';
import { createAuthRouter } from './auth/routes.js';
import type { AppConfig } from './config.js';
import { databaseReady } from './db/connection.js';
import { errorHandler, HttpError, notFoundHandler } from './http/errors.js';
import { requestId } from './http/request-id.js';
import { createQuestionsRouter } from './questions/routes.js';
import { createTemplatesRouter } from './templates/routes.js';
import { createResultsRouter } from './results/routes.js';
import { createRunnerRouter } from './runner/routes.js';

export interface AppDependencies {
  config: AppConfig;
  database: Knex;
  logger: Logger;
}

const createHttpLogger = pinoHttp as unknown as (options: {
  logger: Logger;
  customProps: (request: Request, response: Response) => Record<string, unknown>;
  serializers: { req: (request: Request) => Record<string, unknown> };
}) => RequestHandler;

export function createApp(dependencies: AppDependencies): Express {
  const { config, database, logger } = dependencies;
  const app = express();

  app.disable('x-powered-by');
  if (config.profile === 'render-postgres') app.set('trust proxy', 1);
  app.use(requestId);
  app.use(createHttpLogger({
    logger,
    customProps: (_request, response) => ({ requestId: response.locals.requestId as string | undefined }),
    serializers: {
      req: (request) => ({
        method: request.method,
        url: request.url.replace(/^(\/test\/)[^/?#]+/, '$1[REDACTED]'),
        remoteAddress: request.ip,
      }),
    },
  }));
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());

  app.use('/api/auth', createAuthRouter(database, config));
  app.get('/lab/runner.py', (_request, response) => response.type('text/x-python').sendFile(resolve('colab/runner.py')));
  app.get('/lab/requirements.txt', (_request, response) => response.type('text/plain').sendFile(resolve('colab/requirements.txt')));
  app.get('/lab/QuickInterviewTest.ipynb', (_request, response) => response.download(resolve('colab/QuickInterviewTest.ipynb')));
  app.get('/login', (_request, response) => response.sendFile(resolve('views/login.html')));
  app.get('/status', (_request, response) => response.sendFile(resolve('views/status.html')));
  app.get('/admin', requireAuth(database), (_request, response) => response.sendFile(resolve('views/admin.html')));
  app.get('/test/:candidateToken', async (request, response, next) => {
    try {
      const context = await resolveCandidate(database, request.params.candidateToken);
      if (context.instance.delivery_mode !== 'STANDARD_WEB') {
        throw new HttpError(409, 'DELIVERY_MODE_MISMATCH', 'This attempt uses Colab + Gradio delivery');
      }
      response.sendFile(resolve('views/candidate.html'));
    } catch (error) {
      next(error);
    }
  });

  const candidateLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 300, standardHeaders: true, legacyHeaders: false });
  app.use('/api/candidate', candidateLimiter, createCandidateRouter(database));
  const runnerExchangeLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
  app.use('/api/runner', runnerExchangeLimiter, createRunnerRouter(database, config));

  app.use('/api/admin', requireAuth(database, ['ADMIN']), requirePasswordChangeResolved, requireCsrfForMutations, createAdminUsersRouter(database));
  app.use('/api/questions', requireAuth(database, ['ADMIN', 'INTERVIEWER']), requirePasswordChangeResolved, requireCsrfForMutations, createQuestionsRouter(database));
  app.use('/api/templates', requireAuth(database, ['ADMIN', 'INTERVIEWER']), requirePasswordChangeResolved, requireCsrfForMutations, createTemplatesRouter(database));
  app.use('/api/test-instances', requireAuth(database, ['ADMIN', 'INTERVIEWER']), requirePasswordChangeResolved, requireCsrfForMutations, createTestInstancesRouter(database, config));
  app.use('/api/results', requireAuth(database, ['ADMIN', 'REVIEWER']), requirePasswordChangeResolved, requireCsrfForMutations, createResultsRouter(database));

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', service: 'quick-interview-test' });
  });
  app.get('/ready', async (_request, response, next) => {
    try {
      if (!await databaseReady(database)) throw new HttpError(503, 'NOT_READY', 'Database is unavailable');
      response.json({ status: 'ready', database: 'connected' });
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(resolve('public'), { index: 'index.html', maxAge: config.nodeEnv === 'production' ? '1h' : 0 }));
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
