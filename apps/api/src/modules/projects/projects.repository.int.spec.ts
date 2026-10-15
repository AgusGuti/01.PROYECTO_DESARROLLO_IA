// Integration test: the real repository on a real MongoDB replica set (in memory).
// Anything that relies on an atomic update, a collation or an aggregation is proven here.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMongoDatabase, type Database } from '../../infrastructure/database/mongo.js';
import { testConfig } from '../../testing/test-app.js';
import type { Project, ProjectFields, ProjectListQuery } from './projects.domain.js';
import { createMongoProjectRepository } from './projects.repository.js';
import { PART_A, PART_B, PART_C, validFields } from './testing/fakes.js';

const T0 = new Date('2026-03-01T10:00:00.000Z');
const T1 = new Date('2026-03-01T11:00:00.000Z');
const day = (text: string): Date => new Date(`${text}T00:00:00.000Z`);

const query = (overrides: Partial<ProjectListQuery> = {}): ProjectListQuery => ({
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  order: 'asc',
  ...overrides,
});

describe('projects repository on a real MongoDB', () => {
  let mongo: MongoMemoryReplSet;
  let database: Database;
  const repository = createMongoProjectRepository();
  const collection = () => mongoose.connection.collection('projects');
  const rawOf = (id: string) => collection().findOne({ _id: new mongoose.Types.ObjectId(id) });

  const make = (overrides: Partial<ProjectFields> = {}, now = T0): Promise<Project> =>
    repository.create({ ...validFields, ...overrides }, now);
  const namesOf = async (q: Partial<ProjectListQuery>): Promise<string[]> =>
    (await repository.list(query(q))).items.map((project) => project.name);

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
    it('round-trips a project as a plain object', async () => {
      const created = await make({
        description: 'Para el taller',
        priority: 'high',
        deadline: day('2026-12-24'),
        items: [{ partId: PART_A, quantity: 6 }],
      });

      expect(created).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        name: 'Soportes para el taller',
        description: 'Para el taller',
        priority: 'high',
        deadline: day('2026-12-24'),
        items: [{ partId: PART_A, quantity: 6 }],
        version: 1,
        deletedAt: null,
        createdAt: T0,
        updatedAt: T0,
      });
      expect(await repository.findLiveById(created.id)).toEqual(created);
    });

    it('stores the part ids as ObjectId and the optionals as explicit nulls', async () => {
      const created = await make({ items: [{ partId: PART_A, quantity: 2 }] });

      const raw = await rawOf(created.id);

      expect(raw?.['items']).toEqual([
        { partId: new mongoose.Types.ObjectId(PART_A), quantity: 2 },
      ]);
      expect(raw).toMatchObject({ description: null, deadline: null, deletedAt: null });
    });

    it('does not enforce unique names', async () => {
      await make();
      await make();

      expect(await collection().countDocuments({})).toBe(2);
    });

    it('has no index besides _id', async () => {
      await make();

      const indexes = await collection().indexes();

      expect(indexes.map((index) => index.name)).toEqual(['_id_']);
    });
  });

  describe('findLiveById', () => {
    it('returns null for a missing and for a deleted project', async () => {
      const created = await make();
      await repository.softDelete(created.id, T1);

      expect(await repository.findLiveById(created.id)).toBeNull();
      expect(await repository.findLiveById('0'.repeat(24))).toBeNull();
    });
  });

  describe('update', () => {
    it('changes only the given fields, bumps the version and moves updatedAt', async () => {
      const created = await make({ description: 'x', items: [{ partId: PART_A, quantity: 1 }] });

      const updated = await repository.update(created.id, 1, { name: 'Nuevo' }, T1);

      expect(updated).toEqual({ ...created, name: 'Nuevo', version: 2, updatedAt: T1 });
    });

    it('replaces the lines whole, empties them, and clears the optionals with null', async () => {
      const created = await make({
        description: 'x',
        deadline: day('2026-12-24'),
        items: [{ partId: PART_A, quantity: 1 }],
      });

      const replaced = await repository.update(
        created.id,
        1,
        { items: [{ partId: PART_B, quantity: 3 }] },
        T1,
      );
      const emptied = await repository.update(
        created.id,
        2,
        { items: [], description: null, deadline: null },
        T1,
      );

      expect(replaced?.items).toEqual([{ partId: PART_B, quantity: 3 }]);
      expect(emptied).toMatchObject({ items: [], description: null, deadline: null, version: 3 });
      expect((await rawOf(created.id))?.['items']).toEqual([]);
    });

    it('returns null for a stale version, a deleted project and a missing one, writing nothing', async () => {
      const created = await make();
      const gone = await make();
      await repository.softDelete(gone.id, T1);

      expect(await repository.update(created.id, 9, { name: 'x' }, T1)).toBeNull();
      expect(await repository.update(gone.id, 1, { name: 'x' }, T1)).toBeNull();
      expect(await repository.update('0'.repeat(24), 1, { name: 'x' }, T1)).toBeNull();
      expect(await rawOf(created.id)).toMatchObject({ version: 1, name: validFields.name });
    });

    it('lets exactly one of two simultaneous edits with the same version win', async () => {
      const created = await make();

      const results = await Promise.all([
        repository.update(created.id, 1, { name: 'Uno' }, T1),
        repository.update(created.id, 1, { name: 'Dos' }, T1),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      const raw = await rawOf(created.id);
      expect(raw?.['version']).toBe(2);
      expect(['Uno', 'Dos']).toContain(raw?.['name']);
    });
  });

  describe('softDelete', () => {
    it('keeps the document, sets deletedAt and bumps the version once', async () => {
      const created = await make();

      const [first, second] = await Promise.all([
        repository.softDelete(created.id, T1),
        repository.softDelete(created.id, T1),
      ]);

      expect([first, second].filter((result) => result !== null)).toHaveLength(1);
      expect(await rawOf(created.id)).toMatchObject({ deletedAt: T1, version: 2, updatedAt: T1 });
    });
  });

  describe('list', () => {
    it('never lists a deleted project and counts only the live ones', async () => {
      await make({ name: 'Vivo' });
      const gone = await make({ name: 'Borrado' });
      await repository.softDelete(gone.id, T1);

      const page = await repository.list(query());

      expect(page.items.map((p) => p.name)).toEqual(['Vivo']);
      expect(page.total).toBe(1);
    });

    it('returns plain domain objects without the computed sort keys', async () => {
      await make({ priority: 'urgent' });

      const [project] = (await repository.list(query({ sort: 'priority' }))).items;

      expect(Object.keys(project ?? {}).sort()).toEqual([
        'createdAt',
        'deadline',
        'deletedAt',
        'description',
        'id',
        'items',
        'name',
        'priority',
        'updatedAt',
        'version',
      ]);
    });

    it('sorts by priority from low to urgent and reversed, not alphabetically', async () => {
      await make({ name: 'U', priority: 'urgent' });
      await make({ name: 'L', priority: 'low' });
      await make({ name: 'H', priority: 'high' });
      await make({ name: 'N', priority: 'normal' });

      expect(await namesOf({ sort: 'priority', order: 'asc' })).toEqual(['L', 'N', 'H', 'U']);
      expect(await namesOf({ sort: 'priority', order: 'desc' })).toEqual(['U', 'H', 'N', 'L']);
    });

    it('puts projects without a deadline last in both directions', async () => {
      await make({ name: 'Sin fecha' });
      await make({ name: 'Tarde', deadline: day('2026-12-31') });
      await make({ name: 'Temprano', deadline: day('2026-01-05') });

      expect(await namesOf({ sort: 'deadline', order: 'asc' })).toEqual([
        'Temprano',
        'Tarde',
        'Sin fecha',
      ]);
      expect(await namesOf({ sort: 'deadline', order: 'desc' })).toEqual([
        'Tarde',
        'Temprano',
        'Sin fecha',
      ]);
    });

    it('sorts by name ignoring case and keeping accents distinct, in Spanish', async () => {
      await make({ name: 'zeta' });
      await make({ name: 'Árbol' });
      await make({ name: 'alfa' });
      await make({ name: 'Beta' });

      expect(await namesOf({ sort: 'name', order: 'asc' })).toEqual([
        'alfa',
        'Árbol',
        'Beta',
        'zeta',
      ]);
      expect(await namesOf({ sort: 'name', order: 'desc' })).toEqual([
        'zeta',
        'Beta',
        'Árbol',
        'alfa',
      ]);
    });

    it('sorts by creation time in both directions', async () => {
      await make({ name: 'Primero' }, new Date('2026-03-01T10:00:00.000Z'));
      await make({ name: 'Segundo' }, new Date('2026-03-01T10:00:01.000Z'));

      expect(await namesOf({ sort: 'createdAt', order: 'asc' })).toEqual(['Primero', 'Segundo']);
      expect(await namesOf({ sort: 'createdAt', order: 'desc' })).toEqual(['Segundo', 'Primero']);
    });

    it.each([
      ['deadline', { deadline: day('2026-06-01') }],
      ['priority', { priority: 'high' as const }],
      ['name', {}],
      ['createdAt', {}],
      ['deadline (undated)', {}],
    ] as const)(
      'pages 25 projects with equal %s keys without repeats or gaps, in both directions',
      async (label, fields) => {
        const sort = label === 'deadline (undated)' ? 'deadline' : label;
        const created: string[] = [];
        for (let n = 0; n < 25; n += 1) created.push((await make({ name: 'Same', ...fields })).id);

        for (const order of ['asc', 'desc'] as const) {
          const seen: string[] = [];
          for (const page of [1, 2, 3]) {
            const result = await repository.list(query({ sort, order, page, pageSize: 10 }));
            expect(result.total).toBe(25);
            seen.push(...result.items.map((project) => project.id));
          }
          expect(seen).toHaveLength(25);
          expect(new Set(seen)).toEqual(new Set(created));
          // The tiebreak is `_id` in the same direction as the sort.
          expect(seen).toEqual(
            order === 'asc' ? [...created].sort() : [...created].sort().reverse(),
          );
        }
      },
    );

    it('filters by priority and the total matches the filter', async () => {
      await make({ priority: 'high' });
      await make({ priority: 'high' });
      await make({ priority: 'low' });

      const page = await repository.list(query({ priority: 'high', pageSize: 1 }));

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(2);
    });

    it('filters by priority while sorting by name, and counts the same projects', async () => {
      await make({ name: 'Zeta', priority: 'high' });
      await make({ name: 'Árbol', priority: 'high' });
      await make({ name: 'arbol', priority: 'high' });
      await make({ name: 'Otro', priority: 'low' });
      await make({ name: 'Bajo', priority: 'low' });

      const first = await repository.list(
        query({ priority: 'high', sort: 'name', order: 'asc', pageSize: 2 }),
      );
      const second = await repository.list(
        query({ priority: 'high', sort: 'name', order: 'asc', pageSize: 2, page: 2 }),
      );

      expect(first.total).toBe(3);
      expect(second.total).toBe(3);
      expect(first.items.map((project) => project.name)).toEqual(['arbol', 'Árbol']);
      expect(second.items.map((project) => project.name)).toEqual(['Zeta']);
    });

    it('keeps undated projects after the dated ones across a page boundary', async () => {
      await make({ name: 'Sin fecha 1' });
      await make({ name: 'Con fecha 2', deadline: day('2026-02-02') });
      await make({ name: 'Sin fecha 2' });
      await make({ name: 'Con fecha 1', deadline: day('2026-01-01') });
      await make({ name: 'Con fecha 3', deadline: day('2026-03-03') });

      const names = async (page: number, order: 'asc' | 'desc'): Promise<string[]> =>
        (await repository.list(query({ sort: 'deadline', order, pageSize: 2, page }))).items.map(
          (project) => project.name,
        );

      // Three dated projects fill page 1 and the first slot of page 2, so the boundary falls
      // between dated and undated rows in both directions.
      expect([await names(1, 'asc'), await names(2, 'asc')]).toEqual([
        ['Con fecha 1', 'Con fecha 2'],
        ['Con fecha 3', expect.stringContaining('Sin fecha')],
      ]);
      expect([await names(1, 'desc'), await names(2, 'desc')]).toEqual([
        ['Con fecha 3', 'Con fecha 2'],
        ['Con fecha 1', expect.stringContaining('Sin fecha')],
      ]);
      expect(await names(3, 'asc')).toHaveLength(1);
    });

    it('returns an empty page past the end, still with the true total', async () => {
      await make();

      const page = await repository.list(query({ page: 10_000 }));

      expect(page).toEqual({ items: [], total: 1 });
    });
  });

  describe('usageOfPart', () => {
    it('lists live projects that use the part, sorted by name then id, with the true total', async () => {
      await make({ name: 'Zeta', items: [{ partId: PART_A, quantity: 2 }] });
      const alfa = await make({
        name: 'alfa',
        items: [
          { partId: PART_B, quantity: 1 },
          { partId: PART_A, quantity: 7 },
        ],
      });
      await make({ name: 'Otro', items: [{ partId: PART_B, quantity: 1 }] });
      const gone = await make({ name: 'Borrado', items: [{ partId: PART_A, quantity: 1 }] });
      await repository.softDelete(gone.id, T1);

      const all = await repository.usageOfPart(PART_A, 50);
      const capped = await repository.usageOfPart(PART_A, 1);

      expect(all).toEqual({
        total: 2,
        projects: [
          { id: alfa.id, name: 'alfa', quantity: 7 },
          { id: expect.any(String), name: 'Zeta', quantity: 2 },
        ],
      });
      expect(capped.total).toBe(2);
      expect(capped.projects).toHaveLength(1);
      expect(await repository.usageOfPart(PART_C, 50)).toEqual({ total: 0, projects: [] });
    });
  });

  describe('pullPart', () => {
    it('pulls the line from every live project in one write, moving version and updatedAt', async () => {
      const one = await make({
        name: 'Uno',
        items: [
          { partId: PART_A, quantity: 2 },
          { partId: PART_B, quantity: 1 },
        ],
      });
      const two = await make({ name: 'Dos', items: [{ partId: PART_A, quantity: 5 }] });
      const untouched = await make({ name: 'Tres', items: [{ partId: PART_B, quantity: 1 }] });
      const gone = await make({ name: 'Borrado', items: [{ partId: PART_A, quantity: 1 }] });
      await repository.softDelete(gone.id, T0);

      const changed = await repository.pullPart(PART_A, T1);

      expect(changed).toBe(2);
      expect(await repository.findLiveById(one.id)).toMatchObject({
        items: [{ partId: PART_B, quantity: 1 }],
        version: 2,
        updatedAt: T1,
      });
      expect(await repository.findLiveById(two.id)).toMatchObject({
        items: [],
        version: 2,
        updatedAt: T1,
      });
      expect(await repository.findLiveById(untouched.id)).toMatchObject({ version: 1 });
      expect(await rawOf(gone.id)).toMatchObject({
        version: 2,
        items: [{ partId: new mongoose.Types.ObjectId(PART_A), quantity: 1 }],
      });
    });

    it('is idempotent: repeating it changes nothing', async () => {
      await make({ items: [{ partId: PART_A, quantity: 2 }] });

      const first = await repository.pullPart(PART_A, T1);
      const second = await repository.pullPart(PART_A, T1);

      expect([first, second]).toEqual([1, 0]);
    });
  });
});
