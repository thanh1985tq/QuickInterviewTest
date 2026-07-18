import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { bootstrapUser, SESSION_COOKIE } from '../src/auth/service.js';
import { hashPassword, verifyPassword } from '../src/security/crypto.js';
import { createTestContext } from './helpers.js';

let database: Knex | undefined;
afterEach(async () => database?.destroy());

function cookieFrom(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  const first = header?.[0];
  if (!first) throw new Error('Session cookie was not set');
  return first.split(';')[0] as string;
}

describe('administrative authentication', () => {
  it('uses a salted memory-hard password hash', async () => {
    const first = await hashPassword('a strong test password');
    const second = await hashPassword('a strong test password');
    expect(first).toMatch(/^scrypt\$v=1\$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword('a strong test password', first)).toBe(true);
    expect(await verifyPassword('wrong password', first)).toBe(false);
  });

  it('has no registration API and protects every administrative prefix', async () => {
    const context = await createTestContext();
    database = context.database;
    await request(context.app).post('/api/auth/register').send({}).expect(404);
    await request(context.app).get('/admin').expect(401);
    for (const path of ['/api/admin/users', '/api/questions', '/api/templates', '/api/test-instances', '/api/results']) {
      const response = await request(context.app).get(path).expect(401);
      expect((response.body as { error: { code: string } }).error.code).toBe('AUTHENTICATION_REQUIRED');
    }
  });

  it('logs in, persists the database session, enforces CSRF, and revokes on logout', async () => {
    const context = await createTestContext();
    database = context.database;
    await bootstrapUser(database, { email: 'ADMIN@example.com', password: 'correct horse battery staple', mustChangePassword: false });

    const login = await request(context.app).post('/api/auth/login').send({
      email: 'admin@example.com', password: 'correct horse battery staple',
    }).expect(200);
    const cookie = cookieFrom(login);
    const body = login.body as { csrfToken: string; user: { role: string } };
    expect(body.user.role).toBe('ADMIN');
    expect(cookie).toContain(`${SESSION_COOKIE}=`);

    await request(context.app).get('/api/auth/session').set('Cookie', cookie).expect(200);
    await request(context.app).post('/api/auth/logout').set('Cookie', cookie).expect(403);
    await request(context.app).post('/api/auth/logout')
      .set('Cookie', cookie).set('X-CSRF-Token', body.csrfToken).expect(204);
    await request(context.app).get('/api/auth/session').set('Cookie', cookie).expect(401);
  });

  it('enforces role boundaries', async () => {
    const context = await createTestContext();
    database = context.database;
    await bootstrapUser(database, {
      email: 'interviewer@example.com', password: 'correct horse battery staple', role: 'INTERVIEWER', mustChangePassword: false,
    });
    const login = await request(context.app).post('/api/auth/login').send({
      email: 'interviewer@example.com', password: 'correct horse battery staple',
    }).expect(200);
    const cookie = cookieFrom(login);
    await request(context.app).get('/api/admin/users').set('Cookie', cookie).expect(403);
    await request(context.app).get('/api/results').set('Cookie', cookie).expect(403);
    await request(context.app).get('/api/questions').set('Cookie', cookie).expect(200);
  });

  it('blocks brute-force attempts using database-backed history', async () => {
    const context = await createTestContext({ LOGIN_MAX_FAILURES: '2' });
    database = context.database;
    await bootstrapUser(database, {
      email: 'admin@example.com', password: 'correct horse battery staple', mustChangePassword: false,
    });
    const credentials = { email: 'admin@example.com', password: 'wrong password' };
    await request(context.app).post('/api/auth/login').send(credentials).expect(401);
    await request(context.app).post('/api/auth/login').send(credentials).expect(401);
    const blocked = await request(context.app).post('/api/auth/login').send(credentials).expect(429);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('LOGIN_RATE_LIMITED');
  });

  it('allows only administrators to provision users and requires CSRF', async () => {
    const context = await createTestContext();
    database = context.database;
    await bootstrapUser(database, {
      email: 'admin@example.com', password: 'correct horse battery staple', mustChangePassword: false,
    });
    const login = await request(context.app).post('/api/auth/login').send({
      email: 'admin@example.com', password: 'correct horse battery staple',
    }).expect(200);
    const cookie = cookieFrom(login);
    const { csrfToken } = login.body as { csrfToken: string };
    const newUser = { email: 'reviewer@example.com', password: 'another strong password', role: 'REVIEWER' };
    await request(context.app).post('/api/admin/users').set('Cookie', cookie).send(newUser).expect(403);
    await request(context.app).post('/api/admin/users')
      .set('Cookie', cookie).set('X-CSRF-Token', csrfToken).send(newUser).expect(201);
    const users = await request(context.app).get('/api/admin/users').set('Cookie', cookie).expect(200);
    expect((users.body as { users: unknown[] }).users).toHaveLength(2);
    expect(await database('admin_audit_log').where({ action: 'USER_CREATED' }).first()).toBeTruthy();
  });

  it('forces a bootstrap password change before administrative APIs are available', async () => {
    const context = await createTestContext();
    database = context.database;
    await bootstrapUser(database, { email: 'bootstrap@example.com', password: 'temporary bootstrap password' });
    const login = await request(context.app).post('/api/auth/login').send({
      email: 'bootstrap@example.com', password: 'temporary bootstrap password',
    }).expect(200);
    const cookie = cookieFrom(login);
    const { csrfToken } = login.body as { csrfToken: string };
    const blocked = await request(context.app).get('/api/questions').set('Cookie', cookie).expect(403);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await request(context.app).post('/api/auth/password').set('Cookie', cookie).set('X-CSRF-Token', csrfToken)
      .send({ currentPassword: 'temporary bootstrap password', newPassword: 'permanent strong password' }).expect(204);
    await request(context.app).get('/api/questions').set('Cookie', cookie).expect(200);
    await request(context.app).post('/api/auth/login').send({
      email: 'bootstrap@example.com', password: 'temporary bootstrap password',
    }).expect(401);
    await request(context.app).post('/api/auth/login').send({
      email: 'bootstrap@example.com', password: 'permanent strong password',
    }).expect(200);
  });
});
