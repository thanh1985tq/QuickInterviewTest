import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { AppConfig } from '../config.js';
import { nowIso } from '../domain/types.js';
import type { UserRole } from '../domain/types.js';
import { hashPassword, hashToken, randomToken, verifyPassword } from '../security/crypto.js';

export const SESSION_COOKIE = 'qit_session';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: UserRole;
  is_active: boolean | number;
  must_change_password: boolean | number;
}

interface SessionRow extends UserRow {
  session_id: string;
  csrf_secret: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface AuthContext {
  sessionId: string;
  csrfToken: string;
  user: { id: string; email: string; role: UserRole; mustChangePassword: boolean };
}

export interface LoginResult extends AuthContext {
  sessionToken: string;
  expiresAt: string;
}

export class LoginBlockedError extends Error {}
export class InvalidCredentialsError extends Error {}

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}

export async function bootstrapUser(
  database: Knex,
  input: { email: string; password: string; role?: UserRole; mustChangePassword?: boolean },
): Promise<{ id: string; created: boolean }> {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const existing = await database<UserRow>('users').where({ email }).first();
  const timestamp = nowIso();
  if (existing) {
    await database('users').where({ id: existing.id }).update({
      password_hash: passwordHash,
      role: input.role ?? 'ADMIN',
      is_active: true,
      must_change_password: input.mustChangePassword ?? true,
      updated_at: timestamp,
    });
    await database('user_sessions').where({ user_id: existing.id, revoked_at: null }).update({ revoked_at: timestamp });
    return { id: existing.id, created: false };
  }

  const id = randomUUID();
  await database('users').insert({
    id,
    email,
    password_hash: passwordHash,
    role: input.role ?? 'ADMIN',
    is_active: true,
    must_change_password: input.mustChangePassword ?? true,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return { id, created: true };
}

function principalHash(value: string): string {
  return hashToken(`login-principal:${value}`);
}

export async function login(
  database: Knex,
  config: AppConfig,
  input: { email: string; password: string; ipAddress: string },
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const accountHash = principalHash(email);
  const ipHash = principalHash(input.ipAddress || 'unknown');
  const windowStart = new Date(Date.now() - config.loginWindowMinutes * 60_000).toISOString();
  const failures = await database('login_attempts')
    .where({ successful: false })
    .andWhere('occurred_at', '>=', windowStart)
    .andWhere((query) => query.where({ account_hash: accountHash }).orWhere({ ip_hash: ipHash }))
    .count<{ count: string | number }[]>({ count: '*' });
  if (Number(failures[0]?.count ?? 0) >= config.loginMaxFailures) throw new LoginBlockedError();

  const user = await database<UserRow>('users').where({ email }).first();
  const passwordValid = user
    ? await verifyPassword(input.password, user.password_hash)
    : await verifyPassword(input.password, await hashPassword('nonexistent-account-sentinel'));
  const successful = Boolean(user && passwordValid && user.is_active);
  const timestamp = nowIso();
  await database('login_attempts').insert({
    id: randomUUID(), account_hash: accountHash, ip_hash: ipHash, successful, occurred_at: timestamp,
  });
  if (!successful || !user) throw new InvalidCredentialsError();

  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + config.sessionTtlMinutes * 60_000).toISOString();
  await database('user_sessions').insert({
    id: sessionId,
    token_hash: hashToken(sessionToken),
    user_id: user.id,
    csrf_secret: csrfToken,
    expires_at: expiresAt,
    last_seen_at: timestamp,
    revoked_at: null,
    created_at: timestamp,
  });
  return {
    sessionId,
    sessionToken,
    csrfToken,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: Boolean(user.must_change_password),
    },
  };
}

export async function resolveSession(database: Knex, rawToken: string): Promise<AuthContext | undefined> {
  if (!rawToken) return undefined;
  const row = await database('user_sessions as sessions')
    .join('users', 'users.id', 'sessions.user_id')
    .select<SessionRow[]>(
      'sessions.id as session_id', 'sessions.csrf_secret', 'sessions.expires_at', 'sessions.revoked_at',
      'users.id', 'users.email', 'users.password_hash', 'users.role', 'users.is_active', 'users.must_change_password',
    )
    .where('sessions.token_hash', hashToken(rawToken))
    .first();
  if (!row || row.revoked_at || !row.is_active || new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  await database('user_sessions').where({ id: row.session_id }).update({ last_seen_at: nowIso() });
  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_secret,
    user: {
      id: row.id,
      email: row.email,
      role: row.role,
      mustChangePassword: Boolean(row.must_change_password),
    },
  };
}

export async function logout(database: Knex, sessionId: string): Promise<void> {
  await database('user_sessions').where({ id: sessionId, revoked_at: null }).update({ revoked_at: nowIso() });
}
