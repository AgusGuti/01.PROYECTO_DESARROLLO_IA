// Process entry point: load configuration, connect, listen, and shut down cleanly (standard §6.4).
import type { Logger } from 'pino';
import { createApp } from './app.js';
import { loadConfigFromEnvironment, type Config } from './config/env.js';
import { createMongoDatabase } from './infrastructure/database/mongo.js';
import { createLogger } from './shared/logging/logger.js';

function loadConfigOrExplain(): Config | undefined {
  try {
    return loadConfigFromEnvironment();
  } catch (error) {
    // The logger needs configuration, so this one message goes straight to stderr.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write('Check your .env file against .env.example.\n');
    return undefined;
  }
}

async function main(): Promise<void> {
  const config = loadConfigOrExplain();
  if (config === undefined) {
    process.exitCode = 1;
    return;
  }

  const logger: Logger = createLogger(config);
  const database = createMongoDatabase(config, logger);

  try {
    await database.connect();
  } catch (error) {
    logger.fatal({ err: error }, 'cannot connect to MongoDB; is it running? Try: npm run db:up');
    process.exitCode = 1;
    return;
  }

  const app = createApp({ config, logger, database });
  const server = app.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, 'api listening');
  });
  server.requestTimeout = 30_000;

  let shuttingDown = false;
  const shutdown = (reason: string, exitCode: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = exitCode;
    logger.info({ reason }, 'shutting down');

    // If connections do not drain in time, stop anyway rather than hang forever.
    const forced = setTimeout(() => {
      logger.error('shutdown timed out; forcing exit');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forced.unref();

    server.close(() => {
      void database
        .disconnect()
        .catch((error: unknown) => {
          logger.error({ err: error }, 'error while closing the database connection');
        })
        .finally(() => {
          clearTimeout(forced);
          logger.info('shutdown complete');
        });
    });
    server.closeIdleConnections();
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT', 0);
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM', 0);
  });
  // After an unexpected error the process state is unknown: log, then stop (standard §6.4).
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    shutdown('uncaughtException', 1);
  });
}

void main();
