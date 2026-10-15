// Builds the Express application without opening a port, so tests can drive it directly.
// Middleware order follows standard §6.1: controls run before any protected data is touched.
import cors from 'cors';
import express, { Router, type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from './config/env.js';
import { createHealthModule, type Clock, type DependencyProbe } from './modules/health/index.js';
import { createFilamentsModule } from './modules/filaments/index.js';
import { createPrintersModule } from './modules/printers/index.js';
import { AppError } from './shared/errors/app-error.js';
import { createErrorHandler, notFoundHandler } from './shared/http/error-handler.js';
import { assignRequestId, REQUEST_ID_HEADER } from './shared/http/request-id.js';

export interface AppDependencies {
  config: Config;
  logger: Logger;
  database: DependencyProbe;
  clock?: Clock;
  /** Lets tests replace the printers repository and the usage check with fakes. */
  printers?: Omit<Parameters<typeof createPrintersModule>[0], 'clock'>;
  /** Lets tests replace the filaments repository with a fake. */
  filaments?: Omit<Parameters<typeof createFilamentsModule>[0], 'clock'>;
}

const systemClock: Clock = { now: () => new Date() };

export function createApp({
  config,
  logger,
  database,
  clock = systemClock,
  printers = {},
  filaments = {},
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');

  // 1. Request id and access log.
  app.use(
    pinoHttp({
      logger,
      genReqId: assignRequestId,
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      // Log what is needed to trace a request, not every header (standard §11.1).
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // 2. Security headers.
  app.use(helmet());

  // Health probes sit before CORS and rate limiting: an orchestrator must always get an answer.
  app.use('/health', createHealthModule({ database, clock }).router);

  // 3. CORS: an explicit allowlist. CORS is not authentication (standard §8.1).
  app.use(
    cors({
      origin: [...config.corsOrigins],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'If-Match', REQUEST_ID_HEADER],
      exposedHeaders: ['ETag', REQUEST_ID_HEADER],
      credentials: false,
      maxAge: 600,
    }),
  );

  // 4. Abuse limits. In-memory: correct for one process only (standard §2.2).
  app.use(
    rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.max,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) => {
        next(new AppError('rate_limited', 'Too many requests. Try again shortly.'));
      },
    }),
  );

  // 5. Body parsing with an explicit size limit.
  app.use(express.json({ limit: config.bodyLimit }));

  // 6. Versioned API. Feature modules mount their routers here.
  const v1 = Router();
  app.use('/api/v1', v1);
  v1.use('/printers', createPrintersModule({ clock, ...printers }).router);
  v1.use('/filaments', createFilamentsModule({ clock, ...filaments }).router);

  // 7. Fallbacks: unknown route, then the single error handler. These stay last.
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
