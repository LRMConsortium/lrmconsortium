import { env } from './env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN: Level = env.isProduction ? 'info' : 'debug';

function emit(level: Level, message: string, meta?: unknown): void {
  if (ORDER[level] < ORDER[MIN]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    service: 'lrmc-api',
    message,
    ...(meta !== undefined ? { meta } : {}),
  };
  const sink = level === 'error' || level === 'warn' ? console.error : console.log;
  sink(env.isProduction ? JSON.stringify(line) : `[${level.toUpperCase()}] ${message}` + (meta ? ` ${JSON.stringify(meta)}` : ''));
}

export const logger = {
  debug: (m: string, meta?: unknown) => emit('debug', m, meta),
  info: (m: string, meta?: unknown) => emit('info', m, meta),
  warn: (m: string, meta?: unknown) => emit('warn', m, meta),
  error: (m: string, meta?: unknown) => emit('error', m, meta),
};
