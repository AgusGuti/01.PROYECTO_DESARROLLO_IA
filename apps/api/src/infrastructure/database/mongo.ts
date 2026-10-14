// MongoDB connection lifecycle. Only repositories and this file may import mongoose.
import mongoose from 'mongoose';
import type { Logger } from 'pino';
import type { Config } from '../../config/env.js';

export interface Database {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Resolves true when MongoDB answers a ping. Never throws. */
  ping(): Promise<boolean>;
}

export function createMongoDatabase(
  config: Pick<Config, 'mongodbUri' | 'env'>,
  logger: Logger,
): Database {
  const connection = mongoose.connection;
  connection.on('disconnected', () => {
    logger.warn('mongodb disconnected');
  });
  connection.on('reconnected', () => {
    logger.info('mongodb reconnected');
  });

  return {
    async connect() {
      await mongoose.connect(config.mongodbUri, {
        serverSelectionTimeoutMS: 5_000,
        // Indexes are created by reviewed migrations in production, not on every start (§4.6).
        autoIndex: config.env !== 'production',
      });
      logger.info('mongodb connected');
    },

    async disconnect() {
      await mongoose.disconnect();
    },

    async ping() {
      const { readyState, db } = connection;
      if (readyState !== mongoose.ConnectionStates.connected || db === undefined) return false;
      try {
        await db.admin().ping();
        return true;
      } catch {
        return false;
      }
    },
  };
}
