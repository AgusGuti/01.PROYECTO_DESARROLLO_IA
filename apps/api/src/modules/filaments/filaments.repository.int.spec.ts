// Integration test: the real repository on a real MongoDB replica set (in memory).
// Anything that relies on an atomic update or a collation is proven here.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { AppError } from '../../shared/errors/app-error.js';
import { testConfig } from '../../testing/test-app.js';
import type { Filament, FilamentFields, FilamentListQuery } from './filaments.domain.js';
import { createMongoFilamentRepository } from './filaments.repository.js';
import { validFields } from './testing/fakes.js';

const T0 = new Date('2026-03-01T10:00:00.000Z');
const T1 = new Date('2026-03-01T11:00:00.000Z');
const query = (overrides: Partial<FilamentListQuery> = {}): FilamentListQuery => ({
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  order: 'asc',
  ...overrides,
});

describe('filaments repository on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  const repository = createMongoFilamentRepository();
  const collection = () => mongoose.connection.collection('filaments');
  const rawOf = (id: string) => collection().findOne({ _id: new mongoose.Types.ObjectId(id) });

  const make = (overrides: Partial<FilamentFields> = {}, now = T0): Promise<Filament> =>
    repository.create({ ...validFields, ...overrides }, now);

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    database = createMongoDatabase(
      testConfig({ MONGODB_URI: mongo.getUri('print3d-test') }),
      pino({ level: 'silent' }),
    );
    await database.connect();
  });

  afterAll(async () => {
    await database.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await collection().deleteMany({});
  });

  describe('create', () => {
    it('round-trips the spool as a plain object', async () => {
      const created = await make();

      expect(created).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        ...validFields,
        version: 1,
        deletedAt: null,
        createdAt: T0,
        updatedAt: T0,
      });
      expect(await repository.findLiveById(created.id)).toEqual(created);
    });

    it('stores purchaseDate as UTC midnight and deletedAt as an explicit null', async () => {
      const created = await make({ purchaseDate: new Date('2026-02-17T00:00:00.000Z') });

      const raw = await rawOf(created.id);

      expect(raw).toHaveProperty('purchaseDate', new Date('2026-02-17T00:00:00.000Z'));
      expect(raw).toHaveProperty('deletedAt', null);
      expect(raw).not.toHaveProperty('__v');
    });

    it('allows two identical spools', async () => {
      await make();
      await make();

      expect(await collection().countDocuments({})).toBe(2);
    });

    it('creates no secondary index', async () => {
      await make();

      const indexes = await collection().listIndexes().toArray();

      expect(indexes.map((index): unknown => index.name)).toEqual(['_id_']);
    });

    it('refuses a value outside the limits even if the service were bypassed', async () => {
      const failure = await make({ availableGrams: -1 }).then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(failure).toBeInstanceOf(AppError);
      expect(await collection().countDocuments({})).toBe(0);
    });
  });

  describe('update', () => {
    it('applies only the given fields, bumps the version and sets updatedAt', async () => {
      const spool = await make();

      const updated = await repository.update(spool.id, 1, { colorName: 'Rojo' }, T1);

      expect(updated).toEqual({ ...spool, colorName: 'Rojo', version: 2, updatedAt: T1 });
    });

    it('writes nothing when the version is stale', async () => {
      const spool = await make();

      expect(await repository.update(spool.id, 7, { colorName: 'Rojo' }, T1)).toBeNull();
      expect(await repository.findLiveById(spool.id)).toEqual(spool);
    });

    it('does not touch a deleted spool', async () => {
      const spool = await make();
      await repository.softDelete(spool.id, T1);
      const before = await rawOf(spool.id);

      expect(await repository.update(spool.id, 2, { colorName: 'Rojo' }, T1)).toBeNull();
      expect(await rawOf(spool.id)).toEqual(before);
    });

    it('lets exactly one of two simultaneous edits with the same version win', async () => {
      const spool = await make();

      const results = await Promise.all([
        repository.update(spool.id, 1, { colorName: 'First' }, T1),
        repository.update(spool.id, 1, { colorName: 'Second' }, T1),
      ]);

      const winners = results.filter((result) => result !== null);
      expect(winners).toHaveLength(1);
      expect(await repository.findLiveById(spool.id)).toMatchObject({
        version: 2,
        colorName: winners[0]?.colorName,
      });
    });

    it('never lets a mass-assignment key reach the document', async () => {
      const spool = await make();
      const hostile = JSON.parse(
        '{"brand":"Hacked","deletedAt":"2026-01-01T00:00:00.000Z","version":99,"$set":{"x":1}}',
      ) as Record<string, unknown>;

      await repository.update(spool.id, 1, hostile, T1);

      expect(await repository.findLiveById(spool.id)).toMatchObject({
        brand: 'Hacked',
        version: 2,
        deletedAt: null,
      });
    });
  });

  describe('softDelete', () => {
    it('keeps the document, sets deletedAt and bumps the version', async () => {
      const spool = await make();

      const deleted = await repository.softDelete(spool.id, T1);

      expect(deleted).toMatchObject({ deletedAt: T1, version: 2, updatedAt: T1 });
      expect(await collection().countDocuments({})).toBe(1);
      expect(await repository.findLiveById(spool.id)).toBeNull();
    });

    it('lets exactly one of two simultaneous deletes win', async () => {
      const spool = await make();

      const results = await Promise.all([
        repository.softDelete(spool.id, T1),
        repository.softDelete(spool.id, T1),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(await rawOf(spool.id)).toMatchObject({ version: 2 });
    });

    it('returns null for a missing spool', async () => {
      expect(await repository.softDelete('0'.repeat(24), T1)).toBeNull();
    });
  });

  describe('consume', () => {
    it('takes the grams, bumps the version and stamps updatedAt', async () => {
      const spool = await make({ availableGrams: 500 });

      const updated = await repository.consume(spool.id, 120, T1);

      expect(updated).toEqual({ ...spool, availableGrams: 380, version: 2, updatedAt: T1 });
    });

    it('allows taking exactly what is left', async () => {
      const spool = await make({ availableGrams: 40 });

      expect(await repository.consume(spool.id, 40, T1)).toMatchObject({ availableGrams: 0 });
    });

    it('returns null and changes nothing when asked for one gram too many', async () => {
      const spool = await make({ availableGrams: 40 });
      const before = await rawOf(spool.id);

      expect(await repository.consume(spool.id, 41, T1)).toBeNull();
      expect(await rawOf(spool.id)).toEqual(before);
    });

    it('returns null for a missing and for a deleted spool, and never modifies the deleted one', async () => {
      const spool = await make();
      await repository.softDelete(spool.id, T1);
      const before = await rawOf(spool.id);

      expect(await repository.consume('0'.repeat(24), 1, T1)).toBeNull();
      expect(await repository.consume(spool.id, 1, T1)).toBeNull();
      expect(await rawOf(spool.id)).toEqual(before);
    });

    it('lets 5 parallel consumes of 30 from a stock of 100 succeed exactly 3 times', async () => {
      const spool = await make({ availableGrams: 100 });

      const results = await Promise.all(
        Array.from({ length: 5 }, () => repository.consume(spool.id, 30, T1)),
      );

      expect(results.filter((result) => result !== null)).toHaveLength(3);
      expect(await rawOf(spool.id)).toMatchObject({ availableGrams: 10, version: 4 });
    });

    it('never goes below zero with 20 parallel consumes of 1 from a stock of 7', async () => {
      const spool = await make({ initialGrams: 7, availableGrams: 7 });

      const results = await Promise.all(
        Array.from({ length: 20 }, () => repository.consume(spool.id, 1, T1)),
      );

      expect(results.filter((result) => result !== null)).toHaveLength(7);
      expect(await rawOf(spool.id)).toMatchObject({ availableGrams: 0, version: 8 });
    });

    it('never modifies a deleted spool when a consume races a delete', async () => {
      for (let round = 0; round < 10; round += 1) {
        const spool = await make({ availableGrams: 100 });

        const [consumed, deleted] = await Promise.all([
          repository.consume(spool.id, 10, T1),
          repository.softDelete(spool.id, T1),
        ]);

        // Either order is valid; what must hold is that nothing ran after the delete.
        expect(deleted).not.toBeNull();
        expect(await rawOf(spool.id)).toMatchObject(
          consumed === null
            ? { availableGrams: 100, version: 2 }
            : { availableGrams: 90, version: 3 },
        );
        expect((await rawOf(spool.id))?.['deletedAt']).toEqual(T1);
      }
    });
  });

  describe('list', () => {
    it('returns an empty page with a zero total', async () => {
      expect(await repository.list(query())).toEqual({ items: [], total: 0 });
    });

    it('filters by material and counts only the matches', async () => {
      await make({ brand: 'A', material: 'PETG' });
      await make({ brand: 'B', material: 'PLA' });
      await make({ brand: 'C', material: 'PETG' });

      const result = await repository.list(query({ material: 'PETG' }));

      expect(result.items.map((spool) => spool.brand)).toEqual(['A', 'C']);
      expect(result.total).toBe(2);
    });

    it('filters by stock: true needs grams left, false means exactly zero', async () => {
      await make({ brand: 'Full' });
      await make({ brand: 'One', availableGrams: 1 });
      await make({ brand: 'Empty', availableGrams: 0 });

      const inStock = await repository.list(query({ inStock: true }));
      const empty = await repository.list(query({ inStock: false }));

      expect(inStock.items.map((spool) => spool.brand)).toEqual(['Full', 'One']);
      expect(empty.items.map((spool) => spool.brand)).toEqual(['Empty']);
      expect([inStock.total, empty.total]).toEqual([2, 1]);
    });

    it('combines the material and stock filters', async () => {
      await make({ brand: 'Match', material: 'TPU', availableGrams: 0 });
      await make({ brand: 'WrongMaterial', material: 'PLA', availableGrams: 0 });
      await make({ brand: 'WrongStock', material: 'TPU' });

      const result = await repository.list(query({ material: 'TPU', inStock: false }));

      expect(result.items.map((spool) => spool.brand)).toEqual(['Match']);
    });

    it('sorts every allowed field in both directions', async () => {
      await make(
        { brand: 'banana', availableGrams: 300, purchaseDate: new Date('2026-01-03') },
        T0,
      );
      await make({ brand: 'Apple', availableGrams: 100, purchaseDate: new Date('2026-01-01') }, T1);
      await make(
        { brand: 'cherry', availableGrams: 200, purchaseDate: new Date('2026-01-02') },
        new Date('2026-03-01T12:00:00.000Z'),
      );
      const brands = async (q: Partial<FilamentListQuery>) =>
        (await repository.list(query(q))).items.map((spool) => spool.brand);

      expect(await brands({ sort: 'brand', order: 'asc' })).toEqual(['Apple', 'banana', 'cherry']);
      expect(await brands({ sort: 'brand', order: 'desc' })).toEqual(['cherry', 'banana', 'Apple']);
      expect(await brands({ sort: 'availableGrams', order: 'asc' })).toEqual([
        'Apple',
        'cherry',
        'banana',
      ]);
      expect(await brands({ sort: 'availableGrams', order: 'desc' })).toEqual([
        'banana',
        'cherry',
        'Apple',
      ]);
      expect(await brands({ sort: 'purchaseDate', order: 'asc' })).toEqual([
        'Apple',
        'cherry',
        'banana',
      ]);
      expect(await brands({ sort: 'purchaseDate', order: 'desc' })).toEqual([
        'banana',
        'cherry',
        'Apple',
      ]);
      expect(await brands({ sort: 'createdAt', order: 'asc' })).toEqual([
        'banana',
        'Apple',
        'cherry',
      ]);
      expect(await brands({ sort: 'createdAt', order: 'desc' })).toEqual([
        'cherry',
        'Apple',
        'banana',
      ]);
    });

    it.each(['asc', 'desc'] as const)(
      'pages 25 spools with equal sort keys with no repeats or gaps (%s)',
      async (order) => {
        for (let n = 0; n < 25; n += 1) await make({ brand: 'Same' }, T0);

        const pages = await Promise.all(
          [1, 2, 3].map((page) =>
            repository.list(query({ page, pageSize: 10, sort: 'availableGrams', order })),
          ),
        );

        expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
        expect(pages.map((page) => page.total)).toEqual([25, 25, 25]);
        const ids = pages.flatMap((page) => page.items.map((spool) => spool.id));
        expect(new Set(ids).size).toBe(25);
        // The tie-break follows the same direction as the sort.
        expect(ids).toEqual(order === 'asc' ? [...ids].sort() : [...ids].sort().reverse());
      },
    );

    it('returns no items but the real total beyond the last page', async () => {
      await make();

      expect(await repository.list(query({ page: 9 }))).toEqual({ items: [], total: 1 });
    });

    it('excludes deleted spools from items and total', async () => {
      const gone = await make({ brand: 'Gone' });
      await make({ brand: 'Live' });
      await repository.softDelete(gone.id, T1);

      const result = await repository.list(query());

      expect(result.items.map((spool) => spool.brand)).toEqual(['Live']);
      expect(result.total).toBe(1);
    });
  });

  // Keep last: it closes the connection for the rest of this file.
  describe('when MongoDB is unreachable', () => {
    it('fails with a generic 503 and no driver text', async () => {
      await database.disconnect();

      const error = await repository.list(query()).then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'service_unavailable', status: 503 });
      expect(JSON.stringify({ m: (error as AppError).message })).not.toMatch(
        /mongo|filaments|connect|buffer|127\.0\.0\.1|localhost/i,
      );
    });
  });
});
