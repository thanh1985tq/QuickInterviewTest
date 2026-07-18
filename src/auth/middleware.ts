import type { RequestHandler } from 'express';
import type { Knex } from 'knex';
import type { UserRole } from '../domain/types.js';
import { HttpError } from '../http/errors.js';
import { safeEqual } from '../security/crypto.js';
import { resolveSession, SESSION_COOKIE, type AuthContext } from './service.js';

export function getAuth(response: Parameters<RequestHandler>[1]): AuthContext {
  const auth = response.locals.auth as AuthContext | undefined;
  if (!auth) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Administrative login is required');
  return auth;
}

export function requireAuth(database: Knex, roles?: readonly UserRole[]): RequestHandler {
  return async (request, response, next) => {
    try {
      const cookies = request.cookies as Record<string, string | undefined> | undefined;
      const token = cookies?.[SESSION_COOKIE];
      const auth = token ? await resolveSession(database, token) : undefined;
      if (!auth) throw new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Administrative login is required');
      if (roles && !roles.includes(auth.user.role)) {
        throw new HttpError(403, 'FORBIDDEN', 'This administrative role is not permitted to perform the operation');
      }
      response.locals.auth = auth;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireCsrf: RequestHandler = (request, response, next) => {
  try {
    const auth = getAuth(response);
    const supplied = request.header('x-csrf-token') ?? (request.body as { csrfToken?: string } | undefined)?.csrfToken;
    if (!supplied || !safeEqual(supplied, auth.csrfToken)) {
      throw new HttpError(403, 'CSRF_INVALID', 'A valid CSRF token is required');
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireCsrfForMutations: RequestHandler = (request, response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    next();
    return;
  }
  requireCsrf(request, response, next);
};

export const requirePasswordChangeResolved: RequestHandler = (_request, response, next) => {
  try {
    const auth = getAuth(response);
    if (auth.user.mustChangePassword) {
      throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change the bootstrap password before using administrative APIs');
    }
    next();
  } catch (error) {
    next(error);
  }
};
