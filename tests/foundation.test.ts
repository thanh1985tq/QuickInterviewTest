import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { loadConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { createTestContext } from './helpers.js';

let database: Knex | undefined;
afterEach(async () => database?.destroy());

describe('foundation', () => {
  it('serves liveness, readiness, and the static application', async () => {
    const context = await createTestContext();
    database = context.database;
    await request(context.app).get('/health').expect(200, { status: 'ok', service: 'quick-interview-test' });
    await request(context.app).get('/ready').expect(200, { status: 'ready', database: 'connected' });
    const page = await request(context.app).get('/').expect(200);
    expect(page.text).toContain('QuickInterviewTest');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect(page.headers['x-content-type-options']).toBe('nosniff');
  });

  it('redacts candidate links, authorization headers, and named secrets from structured logs', async () => {
    const context = await createTestContext();
    database = context.database;
    const output: string[] = [];
    const logger = createLogger('info', { write: (chunk: string) => { output.push(chunk); } });
    const config = loadConfig({ APP_PROFILE: 'test', NODE_ENV: 'test', SQLITE_PATH: ':memory:', LOG_LEVEL: 'info' });
    const app = createApp({ config, database, logger });
    const candidateToken = 'candidate-secret-token-that-must-not-appear';
    await request(app).get(`/test/${candidateToken}`).set('Authorization', 'Bearer runner-secret').expect(404);
    logger.info({ password: 'password-secret', token: 'opaque-secret' }, 'redaction check');
    const logs = output.join('');
    expect(logs).not.toContain(candidateToken);
    expect(logs).not.toContain('runner-secret');
    expect(logs).not.toContain('password-secret');
    expect(logs).not.toContain('opaque-secret');
    expect(logs).toContain('[REDACTED]');
  });

  it('adds or preserves a safe request identifier', async () => {
    const context = await createTestContext();
    database = context.database;
    const generated = await request(context.app).get('/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const supplied = await request(context.app).get('/health').set('X-Request-Id', 'client-safe-id');
    expect(supplied.headers['x-request-id']).toBe('client-safe-id');
  });

  it('fails fast on invalid cloud database configuration', () => {
    expect(() => loadConfig({ APP_PROFILE: 'render-postgres', NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ APP_PROFILE: 'render-postgres', NODE_ENV: 'development', DATABASE_URL: 'postgresql://example' })).toThrow(/production/);
  });

  it('returns a stable error envelope without stack traces', async () => {
    const context = await createTestContext();
    database = context.database;
    const response = await request(context.app).get('/does-not-exist').expect(404);
    const body = response.body as { error: { code: string; requestId: string; stack?: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBeTruthy();
    expect(body.error.stack).toBeUndefined();
  });
});
