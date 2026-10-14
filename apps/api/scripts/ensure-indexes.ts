// Usage: npm run db:indexes (from the repository root).
// Creates the MongoDB indexes the application depends on. Safe to run more than once: creating an
// index that already exists changes nothing. Run it on deploy, before starting the API, because
// `autoIndex` is off in production (see docs/runbooks/database-indexes.md).
import { loadConfigFromEnvironment } from '../src/config/env.js';
import { createMongoDatabase } from '../src/infrastructure/database/mongo.js';
import { ensurePrintersIndexes } from '../src/modules/printers/index.js';
import { createLogger } from '../src/shared/logging/logger.js';

const config = loadConfigFromEnvironment();
const logger = createLogger(config);
const database = createMongoDatabase(config, logger);

try {
  await database.connect();
  await ensurePrintersIndexes();
  logger.info('database indexes are in place');
} catch (error) {
  logger.fatal({ err: error }, 'could not create the database indexes');
  process.exitCode = 1;
} finally {
  await database.disconnect().catch(() => undefined);
}
