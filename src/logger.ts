import pino, { type Logger } from 'pino';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'secret',
  'credential',
  'answer',
  'databaseUrl',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.secret',
  '*.credential',
  '*.answer',
  '*.databaseUrl',
];

export function createLogger(level = 'info', destination?: pino.DestinationStream): Logger {
  return pino({
    level,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    base: { service: 'quick-interview-test' },
    timestamp: pino.stdTimeFunctions.isoTime,
  }, destination);
}
