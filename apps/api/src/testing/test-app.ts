// Test support: builds the real application with safe, silent settings.
import type { Express } from 'express';
import { pino } from 'pino';
import { createApp, type AppDependencies } from '../app.js';
import { loadConfig, type Config } from '../config/env.js';

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/print3d-test',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export function createTestApp(
  overrides: Partial<AppDependencies> & { env?: Record<string, string> } = {},
): Express {
  const { env, ...deps } = overrides;
  return createApp({
    config: testConfig(env),
    logger: pino({ level: 'silent' }),
    database: { ping: () => Promise.resolve(true) },
    ...deps,
  });
}
