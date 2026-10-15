// Integration test: the real repository on a real MongoDB replica set (in memory).
// Anything that relies on an index, a unique constraint or an atomic update is proven here.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { AppError } from '../../shared/errors/app-error.js';
import { testConfig } from '../../testing/test-app.js';
import type { Printer, PrinterFields, PrinterListQuery } from './printers.domain.js';
import { createMongoPrinterRepository } from './printers.repository.js';
import { validFields } from './testing/fakes.js';

const T0 = new Date('2026-03-01T10:00:00.000Z');
const T1 = new Date('2026-03-01T11:00:00.000Z');
const query = (overrides: Partial<PrinterListQuery> = {}): PrinterListQuery => ({
  page: 1,
  pageSize: 20,
  sort: 'name',
  order: 'asc',
  ...overrides,
});

describe('printers repository on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  const repository = createMongoPrinterRepository();
  const collection = () => mongoose.connection.collection('printers');

  const make = (name: string, overrides: Partial<PrinterFields> = {}, now = T0): Promise<Printer> =>
    repository.create({ ...validFields, name, ...overrides }, now);

  async function failureOf(promise: Promise<unknown>): Promise<AppError> {
    const error = await promise.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    if (!(error instanceof AppError)) throw new Error('expected an AppError');
    return error;
  }

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    database = createMongoDatabase(
      testConfig({ MONGODB_URI: mongo.getUri('print3d-test') }),
      pino({ level: 'silent' }),
    );
    await database.connect();
    // The same code the production runbook step runs.
    await repository.ensureIndexes();
  });

  afterAll(async () => {
    await database.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await collection().deleteMany({});
  });

  describe('indexes', () => {
    it('creates the unique, case-insensitive name index with no partial filter', async () => {
      const indexes = await collection().listIndexes().toArray();

      const nameIndex = indexes.find((index) => index.name === 'printers_name_unique');
      expect(nameIndex).toMatchObject({
        key: { name: 1 },
        unique: true,
        collation: { locale: 'es', strength: 2 },
      });
      expect(nameIndex).not.toHaveProperty('partialFilterExpression');
      expect(indexes.map((index): unknown => index.name).sort()).toEqual([
        '_id_',
        'printers_name_unique',
      ]);
    });

    it('can be created again without error', async () => {
      await expect(repository.ensureIndexes()).resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    it('round-trips the printer as a plain object', async () => {
      const created = await make('Ender 3', { typicalSpeedMmS: 80, status: 'maintenance' });

      expect(created).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        ...validFields,
        name: 'Ender 3',
        typicalSpeedMmS: 80,
        status: 'maintenance',
        version: 1,
        archivedAt: null,
        deletedAt: null,
        createdAt: T0,
        updatedAt: T0,
      });
      expect(await repository.findLiveById(created.id)).toEqual(created);
    });

    it('writes archivedAt and deletedAt as an explicit null and leaves the speed out when unset', async () => {
      const created = await make('Ender 3', { typicalSpeedMmS: null });

      const raw = await collection().findOne({ name: 'Ender 3' });

      expect(raw).not.toBeNull();
      expect(raw).toHaveProperty('deletedAt', null);
      expect(raw).toHaveProperty('archivedAt', null);
      expect(raw).not.toHaveProperty('typicalSpeedMmS');
      expect(raw).not.toHaveProperty('__v');
      expect(created.typicalSpeedMmS).toBeNull();
    });

    it('enforces uniqueness even for a document inserted with deletedAt absent', async () => {
      const bare = { ...validFields, name: 'Bare', version: 1, createdAt: T0, updatedAt: T0 };

      await collection().insertOne({ ...bare });

      await expect(collection().insertOne({ ...bare })).rejects.toMatchObject({ code: 11000 });
      expect(await collection().countDocuments({ name: 'Bare' })).toBe(1);
    });

    it.each([
      ['a different case', 'ENDER 3'],
      ['all lowercase', 'ender 3'],
    ])('rejects a duplicate name in %s with a conflict on name', async (_label, other) => {
      await make('Ender 3');

      const error = await failureOf(make(other));

      expect(error).toMatchObject({
        code: 'conflict',
        status: 409,
        issues: [{ path: 'name' }],
      });
      expect(await collection().countDocuments({})).toBe(1);
    });

    it('treats accented names as different from unaccented ones but case-insensitive within', async () => {
      await make('Café');

      await expect(make('Cafe')).resolves.toBeDefined();
      expect(await failureOf(make('CAFÉ'))).toMatchObject({ code: 'conflict' });
    });

    it('keeps the driver text out of the conflict message', async () => {
      await make('Ender 3');

      const error = await failureOf(make('ender 3'));

      expect(JSON.stringify({ message: error.message, issues: error.issues })).not.toMatch(
        /E11000|collection|index|print3d|dup key/i,
      );
    });
  });

  describe('findLiveById', () => {
    it('returns null for an unknown id and for a deleted printer', async () => {
      const printer = await make('Ender 3');
      await repository.softDelete(printer.id, T1);

      expect(await repository.findLiveById(printer.id)).toBeNull();
      expect(await repository.findLiveById('0'.repeat(24))).toBeNull();
    });

    it('returns an archived printer', async () => {
      const printer = await make('Ender 3');
      await repository.archive(printer.id, T1);

      expect(await repository.findLiveById(printer.id)).toMatchObject({ archivedAt: T1 });
    });
  });

  describe('update', () => {
    it('applies only the given fields, bumps the version and sets updatedAt', async () => {
      const printer = await make('Ender 3');

      const updated = await repository.update(printer.id, 1, { name: 'Prusa' }, T1);

      expect(updated).toEqual({ ...printer, name: 'Prusa', version: 2, updatedAt: T1 });
    });

    it('replaces nested objects and the materials whole', async () => {
      const printer = await make('Ender 3');

      const updated = await repository.update(
        printer.id,
        1,
        {
          buildVolume: { x: 1, y: 2, z: 3 },
          nozzle: { diameterMm: 0.6, material: 'hardened_steel' },
          compatibleMaterials: ['PA_CF'],
        },
        T1,
      );

      expect(updated).toMatchObject({
        buildVolume: { x: 1, y: 2, z: 3 },
        nozzle: { diameterMm: 0.6, material: 'hardened_steel' },
        compatibleMaterials: ['PA_CF'],
      });
    });

    it('sets, keeps and clears the power independently of the speed', async () => {
      const printer = await make('Ender 3', { powerWatts: null, typicalSpeedMmS: 60 });

      const set = await repository.update(printer.id, 1, { powerWatts: 120 }, T1);
      const kept = await repository.update(printer.id, 2, { status: 'maintenance' }, T1);
      const cleared = await repository.update(printer.id, 3, { powerWatts: null }, T1);

      expect(set).toMatchObject({ powerWatts: 120, typicalSpeedMmS: 60 });
      expect(kept).toMatchObject({ powerWatts: 120 });
      expect(cleared).toMatchObject({ powerWatts: null, typicalSpeedMmS: 60 });
      expect(await collection().findOne({ name: 'Ender 3' })).not.toHaveProperty('powerWatts');
    });

    it('reads a raw document without powerWatts as null', async () => {
      const printer = await make('Ender 3', { powerWatts: null });
      expect(await collection().findOne({ name: 'Ender 3' })).not.toHaveProperty('powerWatts');
      expect((await repository.findLiveById(printer.id))?.powerWatts).toBeNull();
    });

    it('removes the speed field when cleared with null', async () => {
      const printer = await make('Ender 3', { typicalSpeedMmS: 60 });

      const updated = await repository.update(printer.id, 1, { typicalSpeedMmS: null }, T1);

      expect(updated?.typicalSpeedMmS).toBeNull();
      expect(await collection().findOne({ name: 'Ender 3' })).not.toHaveProperty('typicalSpeedMmS');
    });

    it('writes nothing when the version is stale', async () => {
      const printer = await make('Ender 3');

      const result = await repository.update(printer.id, 7, { name: 'Prusa' }, T1);

      expect(result).toBeNull();
      expect(await repository.findLiveById(printer.id)).toEqual(printer);
    });

    it('does not touch a deleted printer', async () => {
      const printer = await make('Ender 3');
      await repository.softDelete(printer.id, T1);
      const before = await collection().findOne({ name: 'Ender 3' });

      const result = await repository.update(printer.id, 2, { name: 'Prusa' }, T1);

      expect(result).toBeNull();
      expect(await collection().findOne({ name: 'Ender 3' })).toEqual(before);
    });

    it('lets a printer take its own name in a different case', async () => {
      const printer = await make('Ender 3');

      const updated = await repository.update(printer.id, 1, { name: 'ENDER 3' }, T1);

      expect(updated?.name).toBe('ENDER 3');
    });

    it('fails with a conflict on name and leaves version and updatedAt alone on a duplicate', async () => {
      await make('Taken');
      const mine = await make('Mine');

      const error = await failureOf(repository.update(mine.id, 1, { name: 'TAKEN' }, T1));

      expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'name' }] });
      expect(await repository.findLiveById(mine.id)).toEqual(mine);
    });

    it('lets exactly one of two simultaneous edits with the same version win', async () => {
      const printer = await make('Ender 3');

      const results = await Promise.all([
        repository.update(printer.id, 1, { name: 'First' }, T1),
        repository.update(printer.id, 1, { name: 'Second' }, T1),
      ]);

      const winners = results.filter((result) => result !== null);
      expect(winners).toHaveLength(1);
      const final = await repository.findLiveById(printer.id);
      expect(final).toMatchObject({ version: 2, name: winners[0]?.name });
    });

    it('never lets a mass-assignment key reach the document', async () => {
      const printer = await make('Ender 3');
      const hostile = JSON.parse(
        '{"name":"Prusa","archivedAt":"2026-01-01T00:00:00.000Z","deletedAt":"2026-01-01T00:00:00.000Z","version":99}',
      ) as Record<string, unknown>;

      // A caller that bypassed the schema still cannot set these: the repository copies named fields.
      await repository.update(printer.id, 1, hostile, T1);

      expect(await repository.findLiveById(printer.id)).toMatchObject({
        name: 'Prusa',
        version: 2,
        archivedAt: null,
        deletedAt: null,
      });
    });
  });

  describe('archive and softDelete', () => {
    it('soft-deletes without removing the document and bumps the version', async () => {
      const printer = await make('Ender 3');

      const deleted = await repository.softDelete(printer.id, T1);

      expect(deleted).toMatchObject({ deletedAt: T1, version: 2, updatedAt: T1 });
      expect(await collection().countDocuments({ name: 'Ender 3' })).toBe(1);
      expect(await collection().findOne({ name: 'Ender 3' })).toHaveProperty('deletedAt', T1);
    });

    it('sets deletedAt once when two deletes run together', async () => {
      const printer = await make('Ender 3');

      const results = await Promise.all([
        repository.softDelete(printer.id, T1),
        repository.softDelete(printer.id, new Date('2026-03-01T12:00:00.000Z')),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      const raw = await collection().findOne({ name: 'Ender 3' });
      expect(raw).toMatchObject({ version: 2 });
      expect([T1.getTime(), new Date('2026-03-01T12:00:00.000Z').getTime()]).toContain(
        (raw?.['deletedAt'] as Date).getTime(),
      );
    });

    it('does not soft-delete a printer that is in use', async () => {
      const printer = await make('Busy', { status: 'in_use' });

      expect(await repository.softDelete(printer.id, T1)).toBeNull();
      expect(await repository.findLiveById(printer.id)).toEqual(printer);
    });

    it('does not soft-delete an archived printer', async () => {
      const printer = await make('Ender 3');
      await repository.archive(printer.id, T1);

      expect(await repository.softDelete(printer.id, T1)).toBeNull();
    });

    it('archives once; a second archive changes nothing', async () => {
      const printer = await make('Ender 3');

      const first = await repository.archive(printer.id, T1);
      const second = await repository.archive(printer.id, new Date('2026-03-01T12:00:00.000Z'));

      expect(first).toMatchObject({ archivedAt: T1, version: 2 });
      expect(second).toBeNull();
      expect(await repository.findLiveById(printer.id)).toMatchObject({
        archivedAt: T1,
        version: 2,
      });
    });

    it('does not archive a deleted printer', async () => {
      const printer = await make('Ender 3');
      await repository.softDelete(printer.id, T1);

      expect(await repository.archive(printer.id, T1)).toBeNull();
    });

    it('lets an edit and a delete run together without modifying a deleted printer', async () => {
      for (let round = 0; round < 10; round += 1) {
        const printer = await make(`Race ${round}`);

        const [edit, removal] = await Promise.all([
          repository.update(printer.id, 1, { name: `Renamed ${round}` }, T1),
          repository.softDelete(printer.id, T1),
        ]);

        const raw = await collection().findOne({ _id: new mongoose.Types.ObjectId(printer.id) });
        expect(removal).not.toBeNull();
        if (edit !== null) {
          // The edit won the race: it ran fully before the delete.
          expect(raw).toMatchObject({ name: `Renamed ${round}`, version: 3 });
        } else {
          expect(raw).toMatchObject({ name: `Race ${round}`, version: 2 });
        }
        expect(raw?.['deletedAt']).toEqual(T1);
      }
    });
  });

  describe('name reservation', () => {
    it('keeps the name of a deleted printer reserved, answering on restoreIfDeleted', async () => {
      const first = await make('Ender 3');
      await repository.softDelete(first.id, T1);

      const error = await failureOf(make('ender 3'));

      expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'restoreIfDeleted' }] });
      expect(JSON.stringify({ message: error.message, issues: error.issues })).not.toContain(
        first.id,
      );
      expect(await collection().countDocuments({})).toBe(1);
    });

    it('keeps the name of an archived printer reserved, answering on name', async () => {
      const first = await make('Ender 3');
      await repository.archive(first.id, T1);

      expect(await failureOf(make('ENDER 3'))).toMatchObject({
        code: 'conflict',
        issues: [{ path: 'name' }],
      });
    });

    it('does not allow a rename onto the name of a deleted printer', async () => {
      const gone = await make('Gone');
      await repository.softDelete(gone.id, T1);
      const mine = await make('Mine');

      const error = await failureOf(repository.update(mine.id, 1, { name: 'GONE' }, T1));

      expect(error).toMatchObject({ code: 'conflict', issues: [{ path: 'name' }] });
    });
  });

  describe('restore', () => {
    const newData: PrinterFields = {
      name: 'ENDER 3',
      buildVolume: { x: 10, y: 20, z: 30 },
      nozzle: { diameterMm: 0.6, material: 'hardened_steel' },
      compatibleMaterials: ['PA_CF'],
      typicalSpeedMmS: null,
      powerWatts: null,
      status: 'maintenance',
    };

    it('revives the deleted printer with the submitted data and keeps one document', async () => {
      const first = await make('Ender 3', { typicalSpeedMmS: 80 });
      await repository.softDelete(first.id, T1);
      const T2 = new Date('2026-03-01T12:00:00.000Z');

      const restored = await repository.restore(newData, T2);

      expect(restored).toEqual({
        ...newData,
        id: first.id,
        version: 3,
        archivedAt: null,
        deletedAt: null,
        createdAt: T0,
        updatedAt: T2,
      });
      expect(await collection().countDocuments({})).toBe(1);
      expect(await collection().findOne({ name: 'ENDER 3' })).not.toHaveProperty('typicalSpeedMmS');
      expect(await collection().findOne({ name: 'ENDER 3' })).not.toHaveProperty('powerWatts');
      expect(await repository.findLiveById(first.id)).toEqual(restored);
    });

    it('applies a submitted power when restoring', async () => {
      const first = await make('Ender 3', { powerWatts: null });
      await repository.softDelete(first.id, T1);

      const restored = await repository.restore({ ...newData, powerWatts: 90 }, T1);

      expect(restored).toMatchObject({ id: first.id, powerWatts: 90 });
      expect(await collection().findOne({ name: 'ENDER 3' })).toHaveProperty('powerWatts', 90);
    });

    it('matches the name ignoring case and composed or decomposed accents', async () => {
      const first = await make('Café');
      await repository.softDelete(first.id, T1);

      const restored = await repository.restore({ ...newData, name: 'CAFÉ' }, T1);

      expect(restored).toMatchObject({ id: first.id, name: 'CAFÉ' });
    });

    it('returns null and writes nothing when a live or archived printer holds the name', async () => {
      const live = await make('Ender 3');
      const pending = await make('Pending');
      await repository.archive(pending.id, T1);
      const before = await collection().find({}).toArray();

      expect(await repository.restore(newData, T1)).toBeNull();
      expect(await repository.restore({ ...newData, name: 'pending' }, T1)).toBeNull();

      expect(await collection().find({}).toArray()).toEqual(before);
      expect(await repository.findLiveById(live.id)).toEqual(live);
    });

    it('returns null when no printer has the name', async () => {
      expect(await repository.restore(newData, T1)).toBeNull();
    });

    it('lets exactly one of two simultaneous restores win', async () => {
      const first = await make('Ender 3');
      await repository.softDelete(first.id, T1);

      const results = await Promise.all([
        repository.restore(newData, T1),
        repository.restore({ ...newData, status: 'available' }, T1),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(await collection().countDocuments({})).toBe(1);
      expect(await collection().findOne({})).toMatchObject({ version: 3, deletedAt: null });
    });
  });

  describe('unarchive', () => {
    it('clears archivedAt, bumps the version and sets updatedAt', async () => {
      const printer = await make('Ender 3');
      await repository.archive(printer.id, T1);
      const T2 = new Date('2026-03-01T12:00:00.000Z');

      const result = await repository.unarchive(printer.id, T2);

      expect(result).toEqual({ ...printer, archivedAt: null, version: 3, updatedAt: T2 });
    });

    it('returns null for a printer that is not archived, deleted, or unknown', async () => {
      const idle = await make('Idle');
      const gone = await make('Gone');
      await repository.softDelete(gone.id, T1);

      expect(await repository.unarchive(idle.id, T1)).toBeNull();
      expect(await repository.unarchive(gone.id, T1)).toBeNull();
      expect(await repository.unarchive('0'.repeat(24), T1)).toBeNull();
      expect(await repository.findLiveById(idle.id)).toEqual(idle);
    });

    it('never modifies a deleted printer when an unarchive races a delete', async () => {
      for (let round = 0; round < 10; round += 1) {
        const printer = await make(`Race ${round}`);
        await repository.archive(printer.id, T0);

        const [unarchived, deleted] = await Promise.all([
          repository.unarchive(printer.id, T1),
          repository.softDelete(printer.id, T1),
        ]);

        // An archived printer cannot be soft-deleted, so the delete can only win AFTER the
        // unarchive. Both orders are valid; the unarchive always succeeds because the delete
        // cannot run first.
        expect(unarchived).not.toBeNull();
        const stored = await collection().findOne({ name: `Race ${round}` });
        expect(stored).toMatchObject({ archivedAt: null });
        // archive -> v2, unarchive -> v3, and a delete that won adds exactly one more (v4):
        // the unarchive never touched the document after the delete.
        expect(stored).toMatchObject(
          deleted === null ? { deletedAt: null, version: 3 } : { version: 4 },
        );
        expect(await collection().countDocuments({ deletedAt: { $ne: null } })).toBe(
          deleted === null ? 0 : 1,
        );
        await collection().deleteMany({});
      }
    });
  });

  describe('list', () => {
    it('returns an empty page with a zero total', async () => {
      expect(await repository.list(query())).toEqual({ items: [], total: 0 });
    });

    it('pages 25 printers as 10, 10 and 5 with no duplicates or gaps', async () => {
      for (let n = 1; n <= 25; n += 1) {
        await make(`Printer ${String(n).padStart(2, '0')}`);
      }

      const pages = await Promise.all(
        [1, 2, 3].map((page) => repository.list(query({ page, pageSize: 10 }))),
      );

      expect(pages.map((page) => page.items.length)).toEqual([10, 10, 5]);
      expect(pages.map((page) => page.total)).toEqual([25, 25, 25]);
      const names = pages.flatMap((page) => page.items.map((printer) => printer.name));
      expect(new Set(names).size).toBe(25);
      expect(names).toEqual([...names].sort());
    });

    it('returns no items but the real total beyond the last page', async () => {
      await make('Only');

      const result = await repository.list(query({ page: 9 }));

      expect(result).toEqual({ items: [], total: 1 });
    });

    it('filters by status and counts only the matches', async () => {
      await make('A', { status: 'maintenance' });
      await make('B');
      await make('C', { status: 'maintenance' });

      const result = await repository.list(query({ status: 'maintenance' }));

      expect(result.items.map((printer) => printer.name)).toEqual(['A', 'C']);
      expect(result.total).toBe(2);
    });

    it('sorts by name ignoring case, using the index collation', async () => {
      await make('banana');
      await make('Apple');
      await make('cherry');

      const asc = await repository.list(query());
      const desc = await repository.list(query({ order: 'desc' }));

      expect(asc.items.map((printer) => printer.name)).toEqual(['Apple', 'banana', 'cherry']);
      expect(desc.items.map((printer) => printer.name)).toEqual(['cherry', 'banana', 'Apple']);
    });

    it('keeps a stable order across pages when createdAt values tie', async () => {
      for (let n = 1; n <= 7; n += 1) await make(`Tie ${n}`, {}, T0);

      const pages = await Promise.all(
        [1, 2, 3, 4].map((page) =>
          repository.list(query({ page, pageSize: 2, sort: 'createdAt' })),
        ),
      );

      const ids = pages.flatMap((page) => page.items.map((printer) => printer.id));
      expect(ids).toHaveLength(7);
      expect(new Set(ids).size).toBe(7);
      expect(ids).toEqual([...ids].sort());
    });

    it('orders createdAt descending with newest first', async () => {
      await make('Old', {}, T0);
      await make('New', {}, T1);

      const result = await repository.list(query({ sort: 'createdAt', order: 'desc' }));

      expect(result.items.map((printer) => printer.name)).toEqual(['New', 'Old']);
    });

    it('excludes deleted printers and includes archived ones in the total', async () => {
      const gone = await make('Gone');
      const pending = await make('Pending');
      await make('Live');
      await repository.softDelete(gone.id, T1);
      await repository.archive(pending.id, T1);

      const result = await repository.list(query());

      expect(result.items.map((printer) => printer.name)).toEqual(['Live', 'Pending']);
      expect(result.total).toBe(2);
    });
  });

  // Keep last: it closes the connection for the rest of this file.
  describe('when MongoDB is unreachable', () => {
    it('fails with a generic 503 and no driver text', async () => {
      await database.disconnect();

      const error = await failureOf(repository.list(query()));

      expect(error).toMatchObject({ code: 'service_unavailable', status: 503 });
      expect(JSON.stringify({ message: error.message, issues: error.issues })).not.toMatch(
        /mongo|printers|connect|buffer|127\.0\.0\.1|localhost/i,
      );
    });
  });
});
