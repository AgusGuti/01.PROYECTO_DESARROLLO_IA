// Integration test: the real repository on a real MongoDB replica set (in memory).
// Anything that relies on an atomic update or a collation is proven here.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { AppError } from '../../shared/errors/app-error.js';
import { testConfig } from '../../testing/test-app.js';
import type { Part, PartFields, PartListQuery } from './parts.domain.js';
import { createMongoPartRepository } from './parts.repository.js';
import { validFields } from './testing/fakes.js';

const T0 = new Date('2026-03-01T10:00:00.000Z');
const T1 = new Date('2026-03-01T11:00:00.000Z');
const gcodeSource = {
  kind: 'gcode',
  fileName: 'florero-espiral.gcode',
  slicer: 'cura',
  analyzedAt: T0,
} as const;

const query = (overrides: Partial<PartListQuery> = {}): PartListQuery => ({
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  order: 'asc',
  ...overrides,
});

describe('parts repository on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  const repository = createMongoPartRepository();
  const collection = () => mongoose.connection.collection('parts');
  const rawOf = (id: string) => collection().findOne({ _id: new mongoose.Types.ObjectId(id) });

  const make = (overrides: Partial<PartFields> = {}, now = T0): Promise<Part> =>
    repository.create({ ...validFields, ...overrides }, now);
  const namesOf = async (q: Partial<PartListQuery>): Promise<string[]> =>
    (await repository.list(query(q))).items.map((part) => part.name);

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
    it('round-trips a manual part as a plain object', async () => {
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

    it('round-trips a gcode source with analyzedAt as a Date', async () => {
      const created = await make({ source: gcodeSource, description: 'Con espiral' });

      const read = await repository.findLiveById(created.id);

      expect(read?.source).toEqual(gcodeSource);
      expect(read?.description).toBe('Con espiral');
      expect((await rawOf(created.id))?.['source']).toEqual(gcodeSource);
    });

    it('stores deletedAt and the optional texts as explicit nulls', async () => {
      const created = await make();

      const raw = await rawOf(created.id);

      expect(raw).toHaveProperty('deletedAt', null);
      expect(raw).toHaveProperty('description', null);
      expect(raw).toHaveProperty('suggestedPrinterName', null);
      expect(raw).not.toHaveProperty('__v');
    });

    it('stores a manual source without gcode fields', async () => {
      const created = await make();

      expect((await rawOf(created.id))?.['source']).toEqual({ kind: 'manual' });
    });

    it('allows two parts with the same name', async () => {
      await make();
      await make();

      expect(await collection().countDocuments({})).toBe(2);
    });

    it('creates no secondary index: only _id_ exists', async () => {
      await make();

      const indexes = await collection().listIndexes().toArray();

      expect(indexes.map((index): unknown => index.name)).toEqual(['_id_']);
    });

    it.each([
      ['a weight of 0', { estimatedWeightGrams: 0 }],
      ['a fractional weight', { estimatedWeightGrams: 1.5 }],
      ['a side of 1001 mm', { dimensionsMm: { x: 1001, y: 1, z: 1 } }],
      ['a layer height of 9 um', { layerHeightUm: 9 }],
      ['a print time of 30 days and 1 s', { estimatedPrintSeconds: 2_592_001 }],
    ])('refuses %s even if the service were bypassed', async (_label, overrides) => {
      const failure = await make(overrides).then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(failure).toBeInstanceOf(AppError);
      expect(await collection().countDocuments({})).toBe(0);
    });
  });

  describe('update', () => {
    it('applies only the given fields, bumps the version and sets updatedAt', async () => {
      const part = await make();

      const updated = await repository.update(part.id, 1, { name: 'Otro' }, T1);

      expect(updated).toEqual({ ...part, name: 'Otro', version: 2, updatedAt: T1 });
    });

    it('replaces the dimensions whole', async () => {
      const part = await make();

      const updated = await repository.update(
        part.id,
        1,
        { dimensionsMm: { x: 10, y: 20, z: 30 } },
        T1,
      );

      expect(updated?.dimensionsMm).toEqual({ x: 10, y: 20, z: 30 });
      expect((await rawOf(part.id))?.['dimensionsMm']).toEqual({ x: 10, y: 20, z: 30 });
    });

    it('clears the optional texts with null and keeps the field as an explicit null', async () => {
      const part = await make({ description: 'Algo', suggestedPrinterName: 'Ender' });

      await repository.update(part.id, 1, { description: null, suggestedPrinterName: null }, T1);

      expect(await rawOf(part.id)).toMatchObject({ description: null, suggestedPrinterName: null });
    });

    it('replaces the source whole: manual drops the gcode fields', async () => {
      const part = await make({ source: gcodeSource });

      await repository.update(part.id, 1, { source: { kind: 'manual' } }, T1);

      expect((await rawOf(part.id))?.['source']).toEqual({ kind: 'manual' });
    });

    it('stores a new gcode source with its new analyzedAt', async () => {
      const part = await make();

      await repository.update(part.id, 1, { source: { ...gcodeSource, analyzedAt: T1 } }, T1);

      expect((await rawOf(part.id))?.['source']).toEqual({ ...gcodeSource, analyzedAt: T1 });
    });

    it('leaves the source alone when the patch has none', async () => {
      const part = await make({ source: gcodeSource });

      await repository.update(part.id, 1, { name: 'Otro' }, T1);

      expect((await rawOf(part.id))?.['source']).toEqual(gcodeSource);
    });

    it('writes nothing when the version is stale', async () => {
      const part = await make();

      expect(await repository.update(part.id, 7, { name: 'Otro' }, T1)).toBeNull();
      expect(await repository.findLiveById(part.id)).toEqual(part);
    });

    it('does not touch a deleted part', async () => {
      const part = await make();
      await repository.softDelete(part.id, T1);
      const before = await rawOf(part.id);

      expect(await repository.update(part.id, 2, { name: 'Otro' }, T1)).toBeNull();
      expect(await rawOf(part.id)).toEqual(before);
    });

    it('refuses an out-of-range value and leaves the document unchanged', async () => {
      const part = await make();

      const failure = await repository.update(part.id, 1, { estimatedWeightGrams: 0 }, T1).then(
        () => undefined,
        (reason: unknown) => reason,
      );

      expect(failure).toBeInstanceOf(AppError);
      expect(await repository.findLiveById(part.id)).toEqual(part);
    });

    it('lets exactly one of two simultaneous edits with the same version win', async () => {
      const part = await make();

      const results = await Promise.all([
        repository.update(part.id, 1, { name: 'First' }, T1),
        repository.update(part.id, 1, { name: 'Second' }, T1),
      ]);

      const winners = results.filter((result) => result !== null);
      expect(winners).toHaveLength(1);
      expect(await repository.findLiveById(part.id)).toMatchObject({
        version: 2,
        name: winners[0]?.name,
      });
    });

    it('never lets a mass-assignment key reach the document', async () => {
      const part = await make();
      const hostile = JSON.parse(
        '{"name":"Hacked","deletedAt":"2026-01-01T00:00:00.000Z","version":99,"$set":{"x":1}}',
      ) as Record<string, unknown>;

      await repository.update(part.id, 1, hostile, T1);

      expect(await repository.findLiveById(part.id)).toMatchObject({
        name: 'Hacked',
        version: 2,
        deletedAt: null,
      });
      expect(await rawOf(part.id)).not.toHaveProperty('x');
    });
  });

  describe('softDelete', () => {
    it('keeps the document, sets deletedAt and bumps the version', async () => {
      const part = await make();

      const deleted = await repository.softDelete(part.id, T1);

      expect(deleted).toMatchObject({ deletedAt: T1, version: 2, updatedAt: T1 });
      expect(await collection().countDocuments({})).toBe(1);
      expect(await repository.findLiveById(part.id)).toBeNull();
    });

    it('lets exactly one of two simultaneous deletes win', async () => {
      const part = await make();

      const results = await Promise.all([
        repository.softDelete(part.id, T1),
        repository.softDelete(part.id, T1),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(await rawOf(part.id)).toMatchObject({ version: 2 });
    });

    it('returns null for a missing part and for a repeated delete', async () => {
      const part = await make();
      await repository.softDelete(part.id, T1);

      expect(await repository.softDelete('0'.repeat(24), T1)).toBeNull();
      expect(await repository.softDelete(part.id, T1)).toBeNull();
    });
  });

  describe('list', () => {
    it('returns an empty page with a zero total', async () => {
      expect(await repository.list(query())).toEqual({ items: [], total: 0 });
    });

    it('filters by material and counts only the matches', async () => {
      await make({ name: 'A', material: 'PETG' });
      await make({ name: 'B', material: 'PLA' });
      await make({ name: 'C', material: 'PETG' });

      const result = await repository.list(query({ material: 'PETG' }));

      expect(result.items.map((part) => part.name)).toEqual(['A', 'C']);
      expect(result.total).toBe(2);
    });

    it('sorts every allowed field in both directions', async () => {
      await make({ name: 'banana', estimatedWeightGrams: 300, estimatedPrintSeconds: 20 }, T0);
      await make({ name: 'Apple', estimatedWeightGrams: 100, estimatedPrintSeconds: 30 }, T1);
      await make(
        { name: 'cherry', estimatedWeightGrams: 200, estimatedPrintSeconds: 10 },
        new Date('2026-03-01T12:00:00.000Z'),
      );

      expect(await namesOf({ sort: 'name', order: 'asc' })).toEqual(['Apple', 'banana', 'cherry']);
      expect(await namesOf({ sort: 'name', order: 'desc' })).toEqual(['cherry', 'banana', 'Apple']);
      expect(await namesOf({ sort: 'estimatedWeightGrams', order: 'asc' })).toEqual([
        'Apple',
        'cherry',
        'banana',
      ]);
      expect(await namesOf({ sort: 'estimatedWeightGrams', order: 'desc' })).toEqual([
        'banana',
        'cherry',
        'Apple',
      ]);
      expect(await namesOf({ sort: 'estimatedPrintSeconds', order: 'asc' })).toEqual([
        'cherry',
        'banana',
        'Apple',
      ]);
      expect(await namesOf({ sort: 'estimatedPrintSeconds', order: 'desc' })).toEqual([
        'Apple',
        'banana',
        'cherry',
      ]);
      expect(await namesOf({ sort: 'createdAt', order: 'asc' })).toEqual([
        'banana',
        'Apple',
        'cherry',
      ]);
      expect(await namesOf({ sort: 'createdAt', order: 'desc' })).toEqual([
        'cherry',
        'Apple',
        'banana',
      ]);
    });

    it('sorts names without regard to case and by Spanish rules (accents, n before enie before o)', async () => {
      for (const name of ['zeta', 'Ángel', 'oso', 'angel', 'ñandú', 'Beto', 'nube']) {
        await make({ name });
      }

      expect(await namesOf({ sort: 'name', order: 'asc' })).toEqual([
        'angel',
        'Ángel',
        'Beto',
        'nube',
        'ñandú',
        'oso',
        'zeta',
      ]);
    });

    it('counts the same parts that a filtered, name-sorted page lists', async () => {
      await make({ name: 'Árbol', material: 'PLA' });
      await make({ name: 'arbol', material: 'PLA' });
      await make({ name: 'Otro', material: 'PETG' });

      const result = await repository.list(query({ sort: 'name', material: 'PLA' }));

      expect(result.total).toBe(2);
      expect(result.items.map((part) => part.name)).toEqual(['arbol', 'Árbol']);
    });

    it.each(['asc', 'desc'] as const)(
      'pages 25 parts with equal sort keys with no repeats or gaps (%s)',
      async (order) => {
        for (let n = 0; n < 25; n += 1) await make({ name: 'Same' }, T0);

        const pages = await Promise.all(
          [1, 2, 3].map((page) =>
            repository.list(query({ page, pageSize: 10, sort: 'name', order })),
          ),
        );

        expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
        expect(pages.map((page) => page.total)).toEqual([25, 25, 25]);
        const ids = pages.flatMap((page) => page.items.map((part) => part.id));
        expect(new Set(ids).size).toBe(25);
        // The tie-break follows the same direction as the sort.
        expect(ids).toEqual(order === 'asc' ? [...ids].sort() : [...ids].sort().reverse());
      },
    );

    it('returns no items but the real total beyond the last page', async () => {
      await make();

      expect(await repository.list(query({ page: 9 }))).toEqual({ items: [], total: 1 });
    });

    it('excludes deleted parts from items and total', async () => {
      const gone = await make({ name: 'Gone' });
      await make({ name: 'Live' });
      await repository.softDelete(gone.id, T1);

      const result = await repository.list(query());

      expect(result.items.map((part) => part.name)).toEqual(['Live']);
      expect(result.total).toBe(1);
    });
  });

  describe('findLiveByIds', () => {
    it('returns only the name and material of the live parts among the ids', async () => {
      const live = await make({ name: 'Viva', material: 'PETG' });
      const gone = await make({ name: 'Borrada' });
      await repository.softDelete(gone.id, T1);

      const found = await repository.findLiveByIds([live.id, gone.id, '0'.repeat(24)]);

      expect(found).toEqual([{ id: live.id, name: 'Viva', material: 'PETG' }]);
    });

    it('answers an empty list for no ids without querying', async () => {
      expect(await repository.findLiveByIds([])).toEqual([]);
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
        /mongo|parts|connect|buffer|127\.0\.0\.1|localhost/i,
      );
    });
  });
});
