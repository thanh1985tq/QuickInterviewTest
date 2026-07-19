import 'dotenv/config';
import { z } from 'zod';

const profileSchema = z.enum(['local-sqlite', 'local-postgres', 'test', 'render-postgres']);

const rawConfigSchema = z.object({
  APP_PROFILE: profileSchema.default('local-sqlite'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1).optional(),
  MIGRATION_DATABASE_URL: z.string().min(1).optional(),
  SQLITE_PATH: z.string().min(1).default('./data/quick-interview.sqlite'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(480),
  CANDIDATE_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(10_080),
  RUNNER_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  RUNNER_CREDENTIAL_TTL_MINUTES: z.coerce.number().int().positive().default(180),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).max(100).default(5),
  HEARTBEAT_OFFLINE_SECONDS: z.coerce.number().int().min(10).default(90),
  DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
  OPEN_API_URL: z.string().url().optional(),
  OPENAI_API_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
});

export type AppProfile = z.infer<typeof profileSchema>;

export interface AppConfig {
  profile: AppProfile;
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  baseUrl: string;
  database: { client: 'sqlite'; filename: string } | { client: 'postgres'; url: string };
  logLevel: string;
  sessionTtlMinutes: number;
  candidateTokenTtlMinutes: number;
  runnerTokenTtlMinutes: number;
  runnerCredentialTtlMinutes: number;
  loginWindowMinutes: number;
  loginMaxFailures: number;
  heartbeatOfflineSeconds: number;
  dataRetentionDays: number;
  secureCookies: boolean;
  ai: { apiUrl: string | null; apiKey: string | null; model: string | null };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawConfigSchema.parse(env);
  const postgres = parsed.APP_PROFILE === 'local-postgres' || parsed.APP_PROFILE === 'render-postgres';

  if (postgres && !parsed.DATABASE_URL) {
    throw new Error(`DATABASE_URL is required for ${parsed.APP_PROFILE}`);
  }
  if (parsed.APP_PROFILE === 'render-postgres' && parsed.NODE_ENV !== 'production') {
    throw new Error('render-postgres requires NODE_ENV=production');
  }

  return {
    profile: parsed.APP_PROFILE,
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST ?? (parsed.APP_PROFILE === 'render-postgres' ? '0.0.0.0' : '127.0.0.1'),
    port: parsed.PORT,
    baseUrl: parsed.BASE_URL.replace(/\/$/, ''),
    database: postgres
      ? { client: 'postgres', url: parsed.DATABASE_URL as string }
      : { client: 'sqlite', filename: parsed.SQLITE_PATH },
    logLevel: parsed.LOG_LEVEL,
    sessionTtlMinutes: parsed.SESSION_TTL_MINUTES,
    candidateTokenTtlMinutes: parsed.CANDIDATE_TOKEN_TTL_MINUTES,
    runnerTokenTtlMinutes: parsed.RUNNER_TOKEN_TTL_MINUTES,
    runnerCredentialTtlMinutes: parsed.RUNNER_CREDENTIAL_TTL_MINUTES,
    loginWindowMinutes: parsed.LOGIN_WINDOW_MINUTES,
    loginMaxFailures: parsed.LOGIN_MAX_FAILURES,
    heartbeatOfflineSeconds: parsed.HEARTBEAT_OFFLINE_SECONDS,
    dataRetentionDays: parsed.DATA_RETENTION_DAYS,
    secureCookies: parsed.APP_PROFILE === 'render-postgres' || parsed.NODE_ENV === 'production',
    ai: {
      apiUrl: (parsed.OPENAI_API_URL ?? parsed.OPEN_API_URL ?? null)?.replace(/\/$/, '') ?? null,
      apiKey: parsed.OPENAI_API_KEY ?? null,
      model: parsed.OPENAI_MODEL ?? null,
    },
  };
}

export function loadMigrationConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const config = loadConfig(env);
  const migrationUrl = rawConfigSchema.parse(env).MIGRATION_DATABASE_URL;

  if (config.database.client !== 'postgres' || !migrationUrl) return config;

  return {
    ...config,
    database: { client: 'postgres', url: migrationUrl },
  };
}
