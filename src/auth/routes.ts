import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { HttpError } from '../http/errors.js';
import { writeAudit } from '../audit/service.js';
import { nowIso } from '../domain/types.js';
import { hashPassword, verifyPassword } from '../security/crypto.js';
import { getAuth, requireAuth, requireCsrf } from './middleware.js';
import { InvalidCredentialsError, login, LoginBlockedError, logout, SESSION_COOKIE } from './service.js';

const loginSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1024),
}).strict();

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().min(12).max(1024),
}).strict();

export function createAuthRouter(database: Knex, config: AppConfig): Router {
  const router = Router();
  router.post('/login', async (request, response, next) => {
    try {
      const input = loginSchema.parse(request.body);
      const result = await login(database, config, { ...input, ipAddress: request.ip ?? 'unknown' });
      response.cookie(SESSION_COOKIE, result.sessionToken, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'lax',
        path: '/',
        maxAge: config.sessionTtlMinutes * 60_000,
      });
      response.json({ user: result.user, csrfToken: result.csrfToken, expiresAt: result.expiresAt });
    } catch (error) {
      if (error instanceof LoginBlockedError) {
        next(new HttpError(429, 'LOGIN_RATE_LIMITED', 'Too many login attempts; try again later'));
      } else if (error instanceof InvalidCredentialsError) {
        next(new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'));
      } else next(error);
    }
  });

  router.get('/session', requireAuth(database), (_request, response) => {
    const auth = getAuth(response);
    response.json({ user: auth.user, csrfToken: auth.csrfToken });
  });

  router.post('/logout', requireAuth(database), requireCsrf, async (_request, response, next) => {
    try {
      await logout(database, getAuth(response).sessionId);
      response.clearCookie(SESSION_COOKIE, { path: '/' });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  router.post('/password', requireAuth(database), requireCsrf, async (request, response, next) => {
    try {
      const input = passwordChangeSchema.parse(request.body);
      const auth = getAuth(response);
      const user = await database<{ id: string; password_hash: string }>('users').where({ id: auth.user.id }).first();
      if (!user || !await verifyPassword(input.currentPassword, user.password_hash)) {
        throw new HttpError(401, 'CURRENT_PASSWORD_INVALID', 'Current password is incorrect');
      }
      const timestamp = nowIso();
      await database.transaction(async (transaction) => {
        await transaction('users').where({ id: auth.user.id }).update({
          password_hash: await hashPassword(input.newPassword), must_change_password: false, updated_at: timestamp,
        });
        await transaction('user_sessions').where({ user_id: auth.user.id, revoked_at: null })
          .whereNot({ id: auth.sessionId }).update({ revoked_at: timestamp });
        await writeAudit(transaction, {
          actorUserId: auth.user.id, action: 'PASSWORD_CHANGED', targetType: 'USER', targetId: auth.user.id,
          requestId: response.locals.requestId as string | undefined,
        });
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
