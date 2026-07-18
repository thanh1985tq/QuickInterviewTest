import { Router, type Response } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import { HttpError } from '../http/errors.js';
import { createDomainSchema, updateDomainSchema } from './schemas.js';
import { createDomain, listDomains, setDomainActive, updateDomain } from './service.js';

const listSchema = z.object({
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
}).strict();

function requireAdministrator(response: Response): void {
  if (getAuth(response).user.role !== 'ADMIN') {
    throw new HttpError(403, 'FORBIDDEN', 'Only administrators can manage interview domains');
  }
}

export function createDomainsRouter(database: Knex): Router {
  const router = Router();

  router.get('/', async (request, response, next) => {
    try {
      const input = listSchema.parse(request.query);
      response.json({ domains: await listDomains(database, input.status) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    try {
      requireAdministrator(response);
      const id = await createDomain(
        database, createDomainSchema.parse(request.body), getAuth(response), response.locals.requestId as string | undefined,
      );
      response.status(201).json({ id });
    } catch (error) {
      next(error);
    }
  });

  router.put('/:domainId', async (request, response, next) => {
    try {
      requireAdministrator(response);
      await updateDomain(
        database, z.string().uuid().parse(request.params.domainId), updateDomainSchema.parse(request.body),
        getAuth(response), response.locals.requestId as string | undefined,
      );
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/:domainId/archive', async (request, response, next) => {
    try {
      requireAdministrator(response);
      await setDomainActive(
        database, z.string().uuid().parse(request.params.domainId), false,
        getAuth(response), response.locals.requestId as string | undefined,
      );
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/:domainId/reactivate', async (request, response, next) => {
    try {
      requireAdministrator(response);
      await setDomainActive(
        database, z.string().uuid().parse(request.params.domainId), true,
        getAuth(response), response.locals.requestId as string | undefined,
      );
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

