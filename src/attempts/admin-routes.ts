import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { writeAudit } from '../audit/service.js';
import { getAuth } from '../auth/middleware.js';
import { deliveryModes, nowIso } from '../domain/types.js';
import { HttpError } from '../http/errors.js';
import { createTestInstance } from './service.js';
import { issueRunnerToken, latestDeployment } from '../runner/service.js';
import { hashToken, randomToken } from '../security/crypto.js';

const createSchema = z.object({
  templateId: z.string().uuid(),
  candidate: z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(300).optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
  }).strict().refine((candidate) => Boolean(candidate.id || candidate.name), 'Candidate ID or name is required'),
  deliveryMode: z.enum(deliveryModes).default('STANDARD_WEB'),
  availableFrom: z.iso.datetime(),
  availableUntil: z.iso.datetime(),
  durationMinutes: z.number().int().positive().max(480).optional(),
}).strict();

const candidateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  email: z.string().trim().email().max(320).nullable().optional(),
}).strict();

interface InstanceListRow {
  id: string;
  delivery_mode: string;
  available_from: string;
  available_until: string;
  duration_minutes: number;
  created_at: string;
  attempt_id: string;
  state: string;
  started_at: string | null;
  deadline_at: string | null;
  submitted_at: string | null;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string | null;
  template_title: string;
}

export function createTestInstancesRouter(database: Knex, config: AppConfig): Router {
  const router = Router();
  router.get('/', async (_request, response, next) => {
    try {
      const rows = await database('test_instances as instances')
        .join('candidate_attempts as attempts', 'attempts.test_instance_id', 'instances.id')
        .join('candidates', 'candidates.id', 'instances.candidate_id')
        .join('test_template_versions as templates', 'templates.id', 'instances.template_version_id')
        .select<InstanceListRow[]>(
          'instances.id', 'instances.delivery_mode', 'instances.available_from', 'instances.available_until',
          'instances.duration_minutes', 'instances.created_at', 'attempts.id as attempt_id', 'attempts.state',
          'attempts.started_at', 'attempts.deadline_at', 'attempts.submitted_at', 'candidates.id as candidate_id',
          'candidates.name as candidate_name', 'candidates.email as candidate_email', 'templates.title as template_title',
        ).orderBy('instances.created_at', 'desc');
      response.json({ instances: rows.map((row) => ({
        id: row.id, attemptId: row.attempt_id, deliveryMode: row.delivery_mode,
        availableFrom: row.available_from, availableUntil: row.available_until,
        durationMinutes: row.duration_minutes, state: row.state, startedAt: row.started_at,
        deadlineAt: row.deadline_at, submittedAt: row.submitted_at,
        candidate: { id: row.candidate_id, name: row.candidate_name, email: row.candidate_email },
        templateTitle: row.template_title,
        deploymentReadiness: row.delivery_mode === 'STANDARD_WEB' ? 'READY' : 'AWAITING_RUNNER',
        createdAt: row.created_at,
      })) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (request, response, next) => {
    try {
      const input = createSchema.parse(request.body);
      const result = await createTestInstance(
        database, config, input, getAuth(response), response.locals.requestId as string | undefined,
      );
      response.status(201).json({
        ...result,
        candidateTokenNotice: 'This token is shown once and is not stored in plaintext.',
        ...(result.runnerToken ? { runnerTokenNotice: 'This single-use runner token is shown once.' } : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:instanceId/cancel', async (request, response, next) => {
    try {
      const instanceId = z.string().uuid().parse(request.params.instanceId);
      const attempt = await database<{ id: string; state: string; test_instance_id: string }>('candidate_attempts')
        .where({ test_instance_id: instanceId }).first();
      if (!attempt) throw new HttpError(404, 'TEST_INSTANCE_NOT_FOUND', 'Test instance was not found');
      if (attempt.state === 'SUBMITTED') throw new HttpError(409, 'ATTEMPT_SUBMITTED', 'A submitted attempt cannot be cancelled');
      const timestamp = nowIso();
      await database.transaction(async (transaction) => {
        await transaction('candidate_attempts').where({ id: attempt.id }).update({ state: 'CANCELLED', updated_at: timestamp });
        await transaction('attempt_events').insert({
          id: randomUUID(), attempt_id: attempt.id, type: 'CANCELLED', details_json: '{}', created_at: timestamp,
        });
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.put('/:instanceId/candidate', async (request, response, next) => {
    try {
      const instanceId = z.string().uuid().parse(request.params.instanceId);
      const input = candidateUpdateSchema.parse(request.body);
      const instance = await database<{ id: string; candidate_id: string }>('test_instances').where({ id: instanceId }).first();
      if (!instance) throw new HttpError(404, 'TEST_INSTANCE_NOT_FOUND', 'Test instance was not found');
      const timestamp = nowIso();
      await database.transaction(async (transaction) => {
        await transaction('candidates').where({ id: instance.candidate_id }).update({
          name: input.name,
          email: input.email?.trim().toLocaleLowerCase('en-US') || null,
          updated_at: timestamp,
        });
        await writeAudit(transaction, {
          actorUserId: getAuth(response).user.id,
          action: 'CANDIDATE_UPDATED',
          targetType: 'CANDIDATE',
          targetId: instance.candidate_id,
          requestId: response.locals.requestId as string | undefined,
          details: { instanceId },
        });
      });
      response.json({ id: instance.candidate_id, name: input.name, email: input.email ?? null });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:instanceId/candidate-link', async (request, response, next) => {
    try {
      const instanceId = z.string().uuid().parse(request.params.instanceId);
      const row = await database('test_instances as instances')
        .join('candidate_attempts as attempts', 'attempts.test_instance_id', 'instances.id')
        .where('instances.id', instanceId)
        .select<{
          attempt_id: string;
          state: string;
          available_until: string;
        }[]>('attempts.id as attempt_id', 'attempts.state', 'instances.available_until')
        .first();
      if (!row) throw new HttpError(404, 'TEST_INSTANCE_NOT_FOUND', 'Test instance was not found');
      if (['SUBMITTED', 'CANCELLED'].includes(row.state)) {
        throw new HttpError(409, 'ATTEMPT_CLOSED', 'A submitted or cancelled attempt cannot receive a new candidate link');
      }
      if (new Date(row.available_until).getTime() <= Date.now()) {
        throw new HttpError(409, 'AVAILABILITY_EXPIRED', 'The attempt availability window has already ended');
      }
      const candidateToken = randomToken();
      const timestamp = nowIso();
      const configuredExpiry = new Date(Date.now() + config.candidateTokenTtlMinutes * 60_000);
      const tokenExpiresAt = new Date(Math.min(new Date(row.available_until).getTime(), configuredExpiry.getTime())).toISOString();
      await database.transaction(async (transaction) => {
        await transaction('candidate_attempts').where({ id: row.attempt_id }).update({
          candidate_token_hash: hashToken(candidateToken),
          token_expires_at: tokenExpiresAt,
          updated_at: timestamp,
        });
        await transaction('attempt_events').insert({
          id: randomUUID(), attempt_id: row.attempt_id, type: 'CANDIDATE_LINK_REISSUED',
          details_json: '{}', created_at: timestamp,
        });
        await writeAudit(transaction, {
          actorUserId: getAuth(response).user.id,
          action: 'CANDIDATE_LINK_REISSUED',
          targetType: 'CANDIDATE_ATTEMPT',
          targetId: row.attempt_id,
          requestId: response.locals.requestId as string | undefined,
          details: { instanceId },
        });
      });
      response.status(201).json({
        candidateUrl: `${config.baseUrl}/test/${encodeURIComponent(candidateToken)}`,
        tokenExpiresAt,
        notice: 'This candidate link is shown once and is not stored in plaintext.',
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/:instanceId', async (request, response, next) => {
    try {
      const instanceId = z.string().uuid().parse(request.params.instanceId);
      const attempt = await database<{ id: string; state: string; test_instance_id: string }>('candidate_attempts')
        .where({ test_instance_id: instanceId }).first();
      if (!attempt) throw new HttpError(404, 'TEST_INSTANCE_NOT_FOUND', 'Test instance was not found');
      if (attempt.state === 'SUBMITTED') throw new HttpError(409, 'ATTEMPT_SUBMITTED', 'A submitted attempt cannot be deleted');
      const timestamp = nowIso();
      await database.transaction(async (transaction) => {
        await transaction('candidate_attempts').where({ id: attempt.id }).update({ state: 'CANCELLED', updated_at: timestamp });
        await transaction('attempt_events').insert({
          id: randomUUID(), attempt_id: attempt.id, type: 'CANCELLED', details_json: '{}', created_at: timestamp,
        });
        await writeAudit(transaction, {
          actorUserId: getAuth(response).user.id,
          action: 'TEST_INSTANCE_CANCELLED',
          targetType: 'TEST_INSTANCE',
          targetId: instanceId,
          requestId: response.locals.requestId as string | undefined,
          details: { attemptId: attempt.id },
        });
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post('/:instanceId/runner-token', async (request, response, next) => {
    try {
      const instanceId = z.string().uuid().parse(request.params.instanceId);
      const attempt = await database<{ id: string; test_instance_id: string }>('candidate_attempts')
        .where({ test_instance_id: instanceId }).first();
      if (!attempt) throw new HttpError(404, 'TEST_INSTANCE_NOT_FOUND', 'Test instance was not found');
      const result = await issueRunnerToken(database, config, attempt.id);
      response.status(201).json({ runnerToken: result.token, expiresAt: result.expiresAt, notice: 'This token is shown once.' });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:instanceId/deployment', async (request, response, next) => {
    try {
      const instanceId = z.string().uuid().parse(request.params.instanceId);
      const attempt = await database<{ id: string; test_instance_id: string }>('candidate_attempts')
        .where({ test_instance_id: instanceId }).first();
      if (!attempt) throw new HttpError(404, 'TEST_INSTANCE_NOT_FOUND', 'Test instance was not found');
      const deployment = await latestDeployment(database, config, attempt.id);
      response.json({ deployment: deployment ? {
        id: deployment.id, generation: deployment.generation, state: deployment.state,
        gradioUrl: deployment.state === 'READY' ? deployment.gradio_url : null,
        gradioUsername: deployment.state === 'READY' ? deployment.gradio_username : null,
        lastHeartbeatAt: deployment.last_heartbeat_at,
      } : null });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:instanceId/delivery', async (request, response, next) => {
    try {
      const instanceId = z.string().uuid().parse(request.params.instanceId);
      const attempt = await database<{ id: string; test_instance_id: string }>('candidate_attempts')
        .where({ test_instance_id: instanceId }).first();
      if (!attempt) throw new HttpError(404, 'TEST_INSTANCE_NOT_FOUND', 'Test instance was not found');
      const deployment = await latestDeployment(database, config, attempt.id);
      if (!deployment || deployment.state !== 'READY' || !deployment.gradio_url) {
        throw new HttpError(409, 'DEPLOYMENT_NOT_READY', 'Lab Mode link cannot be sent until deployment is ready');
      }
      response.json({ gradioUrl: deployment.gradio_url, username: deployment.gradio_username, state: deployment.state });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
