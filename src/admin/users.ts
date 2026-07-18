import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { writeAudit } from '../audit/service.js';
import { getAuth } from '../auth/middleware.js';
import { normalizeEmail } from '../auth/service.js';
import { nowIso, userRoles } from '../domain/types.js';
import { HttpError } from '../http/errors.js';
import { hashPassword } from '../security/crypto.js';

interface AdminUserRow {
  id: string;
  email: string;
  role: string;
  is_active: boolean | number;
  must_change_password: boolean | number;
  created_at: string;
  updated_at: string;
}

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  request_id: string | null;
  details_json: string;
  created_at: string;
}

const createUserSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(12).max(1024),
  role: z.enum(userRoles),
  mustChangePassword: z.boolean().default(true),
}).strict();

const updateUserSchema = z.object({
  role: z.enum(userRoles).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(12).max(1024).optional(),
  mustChangePassword: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export function createAdminUsersRouter(database: Knex): Router {
  const router = Router();
  router.get('/audit', async (request, response, next) => {
    try {
      const query = z.object({
        actorUserId: z.string().uuid().optional(),
        action: z.string().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }).strict().parse(request.query);
      let rows = database('admin_audit_log as audit').leftJoin('users', 'users.id', 'audit.actor_user_id')
        .select<AuditRow[]>('audit.id', 'audit.actor_user_id', 'users.email as actor_email', 'audit.action',
          'audit.target_type', 'audit.target_id', 'audit.request_id', 'audit.details_json', 'audit.created_at');
      if (query.actorUserId) rows = rows.where('audit.actor_user_id', query.actorUserId);
      if (query.action) rows = rows.where('audit.action', query.action);
      const audit = await rows.orderBy('audit.created_at', 'desc').limit(query.limit);
      response.json({ audit: audit.map((entry) => ({
        id: entry.id, actorUserId: entry.actor_user_id,
        actorEmail: entry.actor_email, action: entry.action,
        targetType: entry.target_type, targetId: entry.target_id,
        requestId: entry.request_id, details: JSON.parse(entry.details_json) as unknown,
        createdAt: entry.created_at,
      })) });
    } catch (error) {
      next(error);
    }
  });
  router.get('/users', async (_request, response, next) => {
    try {
      const rows = await database<AdminUserRow>('users')
        .select<AdminUserRow[]>('id', 'email', 'role', 'is_active', 'must_change_password', 'created_at', 'updated_at')
        .orderBy('created_at', 'asc');
      response.json({ users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        isActive: Boolean(row.is_active),
        mustChangePassword: Boolean(row.must_change_password),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/users', async (request, response, next) => {
    try {
      const input = createUserSchema.parse(request.body);
      const auth = getAuth(response);
      const id = randomUUID();
      const timestamp = nowIso();
      const email = normalizeEmail(input.email);
      const duplicate = await database<AdminUserRow>('users').where({ email }).first('id');
      if (duplicate) throw new HttpError(409, 'EMAIL_EXISTS', 'An administrative user already has this email');
      await database.transaction(async (transaction) => {
        await transaction('users').insert({
          id, email, password_hash: await hashPassword(input.password), role: input.role,
          is_active: true, must_change_password: input.mustChangePassword,
          created_at: timestamp, updated_at: timestamp,
        });
        await writeAudit(transaction, {
          actorUserId: auth.user.id, action: 'USER_CREATED', targetType: 'USER', targetId: id,
          requestId: response.locals.requestId as string | undefined,
          details: { email, role: input.role },
        });
      });
      response.status(201).json({ id, email, role: input.role });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/users/:userId', async (request, response, next) => {
    try {
      const userId = z.string().uuid().parse(request.params.userId);
      const input = updateUserSchema.parse(request.body);
      const auth = getAuth(response);
      const existing = await database<AdminUserRow>('users').where({ id: userId }).first();
      if (!existing) throw new HttpError(404, 'USER_NOT_FOUND', 'Administrative user was not found');
      if (userId === auth.user.id && input.isActive === false) {
        throw new HttpError(409, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account');
      }
      const changes: Record<string, unknown> = { updated_at: nowIso() };
      if (input.role !== undefined) changes.role = input.role;
      if (input.isActive !== undefined) changes.is_active = input.isActive;
      if (input.password !== undefined) changes.password_hash = await hashPassword(input.password);
      if (input.mustChangePassword !== undefined) changes.must_change_password = input.mustChangePassword;
      await database.transaction(async (transaction) => {
        await transaction('users').where({ id: userId }).update(changes);
        if (input.password !== undefined || input.isActive === false) {
          await transaction('user_sessions').where({ user_id: userId, revoked_at: null }).update({ revoked_at: nowIso() });
        }
        await writeAudit(transaction, {
          actorUserId: auth.user.id, action: 'USER_UPDATED', targetType: 'USER', targetId: userId,
          requestId: response.locals.requestId as string | undefined,
          details: { role: input.role, isActive: input.isActive, passwordRotated: input.password !== undefined },
        });
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
