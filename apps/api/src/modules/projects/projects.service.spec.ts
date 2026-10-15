import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { createProjectsService, type NewProject } from './projects.service.js';
import {
  createFakePartLookup,
  createFakeProjectRepository,
  createTestClock,
  PART_A,
  PART_B,
  PART_C,
} from './testing/fakes.js';

function setup() {
  const repository = createFakeProjectRepository();
  const parts = createFakePartLookup();
  const clock = createTestClock();
  const service = createProjectsService({ repository, partLookup: parts.lookup, clock });
  return { repository, parts, clock, service };
}

const newProject: NewProject = { name: 'Soportes para el taller', priority: 'normal', items: [] };
const MISSING = '0'.repeat(24);

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError');
  return error;
}

describe('create', () => {
  it('stamps version 1 and the clock time, with null for the optional fields', async () => {
    const { service, clock } = setup();

    const { project } = await service.create(newProject);

    expect(project).toMatchObject({
      description: null,
      deadline: null,
      priority: 'normal',
      items: [],
      version: 1,
      deletedAt: null,
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });
  });

  it('does not call the lookup for a project without lines', async () => {
    const { service, parts } = setup();

    await service.create(newProject);

    expect(parts.calls).toEqual([]);
  });

  it('checks the parts with one lookup and returns them for the response', async () => {
    const { service, parts } = setup();

    const detail = await service.create({
      ...newProject,
      items: [
        { partId: PART_A, quantity: 6 },
        { partId: PART_B, quantity: 2 },
      ],
    });

    expect(parts.calls).toEqual([[PART_A, PART_B]]);
    expect(detail.parts.get(PART_A)).toEqual({ name: 'Soporte de estante en L', material: 'PETG' });
  });

  it('rejects a repeated part on its second occurrence and does not call the lookup', async () => {
    const { service, parts, repository } = setup();

    const error = await failureOf(
      service.create({
        ...newProject,
        items: [
          { partId: PART_A, quantity: 1 },
          { partId: PART_A, quantity: 2 },
        ],
      }),
    );

    expect(error.code).toBe('validation_failed');
    expect(error.issues).toEqual([{ path: 'items.1.partId', message: 'Duplicated part.' }]);
    expect(parts.calls).toEqual([]);
    expect(repository.calls).toEqual([]);
  });

  it('gives the same issue to an unknown part and to a deleted part', async () => {
    const { service, parts, repository } = setup();
    parts.live.delete(PART_B);

    const error = await failureOf(
      service.create({
        ...newProject,
        items: [
          { partId: PART_A, quantity: 1 },
          { partId: PART_B, quantity: 1 },
          { partId: PART_C, quantity: 1 },
        ],
      }),
    );

    expect(error.issues).toEqual([
      { path: 'items.1.partId', message: 'The part does not exist.' },
      { path: 'items.2.partId', message: 'The part does not exist.' },
    ]);
    expect(repository.calls).toEqual([]);
  });

  it('answers 503 and stores nothing when the lookup fails', async () => {
    const { service, parts, repository } = setup();
    parts.failWith = new Error('connection refused 10.1.2.3');

    const error = await failureOf(
      service.create({ ...newProject, items: [{ partId: PART_A, quantity: 1 }] }),
    );

    expect(error.code).toBe('service_unavailable');
    expect(error.message).not.toMatch(/10\.1\.2\.3/);
    expect(repository.calls).toEqual([]);
  });
});

describe('get', () => {
  it('asks the lookup once for the parts of all the lines', async () => {
    const { service, repository, parts } = setup();
    const seeded = repository.seed({
      items: [
        { partId: PART_A, quantity: 1 },
        { partId: PART_B, quantity: 1 },
      ],
    });

    const detail = await service.get(seeded.id);

    expect(parts.calls).toHaveLength(1);
    expect([...detail.parts.keys()].sort()).toEqual([PART_A, PART_B]);
  });

  it('leaves out a part that is no longer live', async () => {
    const { service, repository, parts } = setup();
    parts.live.delete(PART_A);
    const seeded = repository.seed({ items: [{ partId: PART_A, quantity: 1 }] });

    const detail = await service.get(seeded.id);

    expect(detail.parts.has(PART_A)).toBe(false);
  });

  it('answers 404 for a missing or deleted project without calling the lookup', async () => {
    const { service, repository, parts } = setup();
    const gone = repository.seed({ deletedAt: new Date() });

    expect((await failureOf(service.get(MISSING))).code).toBe('not_found');
    expect((await failureOf(service.get(gone.id))).code).toBe('not_found');
    expect(parts.calls).toEqual([]);
  });

  it('answers 503 when the lookup fails', async () => {
    const { service, repository, parts } = setup();
    const seeded = repository.seed({ items: [{ partId: PART_A, quantity: 1 }] });
    parts.failWith = new AppError(
      'service_unavailable',
      'The part data is temporarily unavailable.',
    );

    expect((await failureOf(service.get(seeded.id))).code).toBe('service_unavailable');
  });
});

describe('update', () => {
  const lines = [{ partId: PART_A, quantity: 4 }];

  it('keeps the lines when the patch does not carry them', async () => {
    const { service, repository } = setup();
    const seeded = repository.seed({ items: lines });

    const { project } = await service.update(seeded.id, { version: 1, name: 'Otro' });

    expect(project).toMatchObject({ name: 'Otro', items: lines, version: 2 });
  });

  it('replaces the lines whole and empties them with []', async () => {
    const { service, repository } = setup();
    const seeded = repository.seed({ items: lines });

    const replaced = await service.update(seeded.id, {
      version: 1,
      items: [{ partId: PART_B, quantity: 1 }],
    });
    const emptied = await service.update(seeded.id, { version: 2, items: [] });

    expect(replaced.project.items).toEqual([{ partId: PART_B, quantity: 1 }]);
    expect(emptied.project).toMatchObject({ items: [], version: 3 });
  });

  it('clears the description and the deadline with null and moves updatedAt', async () => {
    const { service, repository, clock } = setup();
    const seeded = repository.seed({ description: 'x', deadline: new Date('2026-12-01') });
    clock.advanceSeconds(60);

    const { project } = await service.update(seeded.id, {
      version: 1,
      description: null,
      deadline: null,
    });

    expect(project).toMatchObject({ description: null, deadline: null, updatedAt: clock.now() });
  });

  it('asks the lookup once for the response when the patch has no lines', async () => {
    const { service, repository, parts } = setup();
    const seeded = repository.seed({ items: lines });

    await service.update(seeded.id, { version: 1, priority: 'high' });

    expect(parts.calls).toHaveLength(1);
  });

  it('uses the same single lookup for the check and the response when lines are replaced', async () => {
    const { service, repository, parts } = setup();
    const seeded = repository.seed();

    await service.update(seeded.id, { version: 1, items: lines });

    expect(parts.calls).toHaveLength(1);
  });

  it('answers 404 for a missing project before anything else', async () => {
    const { service, parts } = setup();

    const error = await failureOf(service.update(MISSING, { version: 1, items: lines }));

    expect(error.code).toBe('not_found');
    expect(parts.calls).toEqual([]);
  });

  it('answers 409 on a stale version even when the lines name a part that does not exist', async () => {
    const { service, repository, parts } = setup();
    const seeded = repository.seed({ version: 3 });
    parts.live.clear();

    const error = await failureOf(service.update(seeded.id, { version: 1, items: lines }));

    expect(error.code).toBe('conflict');
    expect(error.issues).toEqual([
      { path: 'version', message: 'Does not match the current version.' },
    ]);
    expect(parts.calls).toEqual([]);
  });

  it('answers 400 for duplicates and for a missing part, without writing', async () => {
    const { service, repository, parts } = setup();
    const seeded = repository.seed();

    const duplicated = await failureOf(
      service.update(seeded.id, { version: 1, items: [...lines, ...lines] }),
    );
    parts.live.clear();
    const missing = await failureOf(service.update(seeded.id, { version: 1, items: lines }));

    expect(duplicated.issues[0]).toEqual({ path: 'items.1.partId', message: 'Duplicated part.' });
    expect(missing.issues[0]).toEqual({
      path: 'items.0.partId',
      message: 'The part does not exist.',
    });
    expect(repository.calls).not.toContain('update');
  });

  it('answers 503 and writes nothing when the lookup fails', async () => {
    const { service, repository, parts } = setup();
    const seeded = repository.seed();
    parts.failWith = new Error('boom');

    const error = await failureOf(service.update(seeded.id, { version: 1, items: lines }));

    expect(error.code).toBe('service_unavailable');
    expect(repository.calls).not.toContain('update');
  });

  it('answers 409 when someone changed it between the read and the write', async () => {
    const { service, repository } = setup();
    const seeded = repository.seed();
    const original = repository.update.bind(repository);
    repository.update = async (id, version, patch, now) => {
      await original(id, version, { name: 'Ganador' }, now);
      return original(id, version, patch, now);
    };

    const error = await failureOf(service.update(seeded.id, { version: 1, name: 'Perdedor' }));

    expect(error.code).toBe('conflict');
    expect(repository.stored.get(seeded.id)?.name).toBe('Ganador');
  });

  it('answers 404 when it was deleted between the read and the write', async () => {
    const { service, repository } = setup();
    const seeded = repository.seed();
    const original = repository.update.bind(repository);
    repository.update = async (id, version, patch, now) => {
      await repository.softDelete(id, now);
      return original(id, version, patch, now);
    };

    const error = await failureOf(service.update(seeded.id, { version: 1, name: 'Otro' }));

    expect(error.code).toBe('not_found');
  });
});

describe('remove', () => {
  it('deletes logically, bumps the version and then answers 404', async () => {
    const { service, repository } = setup();
    const seeded = repository.seed();

    await service.remove(seeded.id);

    expect(repository.stored.get(seeded.id)).toMatchObject({ version: 2 });
    expect((await failureOf(service.remove(seeded.id))).code).toBe('not_found');
    expect((await failureOf(service.get(seeded.id))).code).toBe('not_found');
  });

  it('answers 404 for a missing project', async () => {
    const { service } = setup();

    expect((await failureOf(service.remove(MISSING))).code).toBe('not_found');
  });
});

describe('the usage port for the parts module', () => {
  it('lists the live projects that use a part, sorted by name, with the true total', async () => {
    const { service, repository } = setup();
    repository.seed({ name: 'Zeta', items: [{ partId: PART_A, quantity: 2 }] });
    repository.seed({ name: 'alfa', items: [{ partId: PART_A, quantity: 7 }] });
    repository.seed({ name: 'Otro', items: [{ partId: PART_B, quantity: 1 }] });
    repository.seed({
      name: 'Borrado',
      deletedAt: new Date(),
      items: [{ partId: PART_A, quantity: 1 }],
    });

    const usage = await service.usageOfPart(PART_A, 1);

    expect(usage.total).toBe(2);
    expect(usage.projects).toEqual([{ id: expect.any(String), name: 'alfa', quantity: 7 }]);
  });

  it('pulls the part from live projects only, moves their version and is idempotent', async () => {
    const { service, repository, clock } = setup();
    const live = repository.seed({
      items: [
        { partId: PART_A, quantity: 2 },
        { partId: PART_B, quantity: 1 },
      ],
    });
    const gone = repository.seed({
      deletedAt: new Date(),
      items: [{ partId: PART_A, quantity: 1 }],
    });
    clock.advanceSeconds(30);

    const first = await service.removePartFromProjects(PART_A, clock.now());
    const second = await service.removePartFromProjects(PART_A, clock.now());

    expect([first, second]).toEqual([1, 0]);
    expect(repository.stored.get(live.id)).toMatchObject({
      items: [{ partId: PART_B, quantity: 1 }],
      version: 2,
      updatedAt: clock.now(),
    });
    expect(repository.stored.get(gone.id)).toMatchObject({
      items: [{ partId: PART_A, quantity: 1 }],
      version: 1,
    });
  });
});

describe('list', () => {
  it('passes the query to the repository and returns its page', async () => {
    const { service, repository } = setup();
    repository.seed();

    const page = await service.list({ page: 1, pageSize: 20, sort: 'createdAt', order: 'desc' });

    expect(page.total).toBe(1);
  });
});
