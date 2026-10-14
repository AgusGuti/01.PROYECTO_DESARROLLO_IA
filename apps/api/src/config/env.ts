// The only place that reads environment variables. Everything else receives a typed Config.
// Standard §6.5: validate at startup and fail fast when configuration is missing or wrong.
import { z } from 'zod';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    MONGODB_URI: z
      .string()
      .regex(/^mongodb(\+srv)?:\/\/.+/, 'must be a mongodb:// or mongodb+srv:// connection string'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:4200')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      )
      .pipe(z.array(z.url()).min(1)),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    BODY_LIMIT: z
      .string()
      .regex(/^\d+(b|kb|mb)$/i, 'use a size such as 100kb')
      .default('100kb'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    ASSISTANT_URL: z.url().default('http://127.0.0.1:8000'),
    // Set only by the container image, where the port is published on the host loopback.
    CONTAINERIZED: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((env, context) => {
    // EXC-0001: there is no authentication yet, so the API must not be reachable from the network.
    if (env.CONTAINERIZED === 'false' && !LOOPBACK_HOSTS.has(env.HOST)) {
      context.addIssue({
        code: 'custom',
        path: ['HOST'],
        message: 'must be a loopback address while the API has no authentication (EXC-0001)',
      });
    }
  });

export type Config = Readonly<{
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  mongodbUri: string;
  corsOrigins: readonly string[];
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  bodyLimit: string;
  rateLimit: Readonly<{ windowMs: number; max: number }>;
  shutdownTimeoutMs: number;
  assistantUrl: string;
}>;

export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/** Pure: takes the raw variables, returns a validated Config or throws ConfigError. */
export function loadConfig(source: Readonly<Record<string, string | undefined>>): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Report variable names and reasons only, never the values: they may be secrets.
    throw new ConfigError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`,
      ),
    );
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    mongodbUri: env.MONGODB_URI,
    corsOrigins: env.CORS_ORIGINS,
    logLevel: env.LOG_LEVEL,
    bodyLimit: env.BODY_LIMIT,
    rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    assistantUrl: env.ASSISTANT_URL,
  };
}

export function loadConfigFromEnvironment(): Config {
  return loadConfig(process.env);
}
