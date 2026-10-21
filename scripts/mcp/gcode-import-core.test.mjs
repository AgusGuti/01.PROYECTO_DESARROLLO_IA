import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decide, findGcodes, partName, toPart } from './gcode-import-core.mjs';

const analysis = {
  estimatedPrintSeconds: 3600,
  filamentGrams: 12,
  layerHeightUm: 200,
  dimensionsMm: { x: 10, y: 20, z: 30 },
};

test('partName turns a file name into a readable name', () => {
  assert.equal(
    partName('Minis/Bowden_square_cutter_0.4mm_3gr.gcode'),
    'Bowden square cutter 0.4mm 3gr',
  );
  assert.equal(Array.from(partName(`${'a'.repeat(300)}.gcode`)).length, 100);
});

test('toPart skips a file the API cannot describe completely', () => {
  assert.equal(toPart('a.gcode', { ...analysis, dimensionsMm: null }, 'PLA').skip, 'no-dimensions');
  assert.equal(toPart('a.gcode', { ...analysis, filamentGrams: 0 }, 'PLA').skip, 'no-weight');
  assert.equal(
    toPart('a.gcode', { ...analysis, layerHeightUm: null }, 'PLA').skip,
    'no-layer-height',
  );
  assert.equal(
    toPart('a.gcode', { ...analysis, estimatedPrintSeconds: 0 }, 'PLA').skip,
    'no-print-time',
  );
});

test('decide creates, leaves alone or updates without renaming', () => {
  const { fields } = toPart('Minis/a_b.gcode', analysis, 'PLA');
  assert.equal(fields.source.fileName, 'Minis/a_b.gcode');
  assert.equal(decide(fields, undefined).action, 'create');
  const stored = { ...fields, id: 'x', version: 3, name: 'My own name' };
  assert.equal(decide(fields, stored).action, 'unchanged');
  const update = decide({ ...fields, estimatedWeightGrams: 99 }, stored);
  assert.equal(update.action, 'update');
  assert.equal(update.body.version, 3);
  assert.equal('name' in update.body, false);
});

test('findGcodes is recursive, only .gcode, stays inside the root and ignores links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gcodes-'));
  try {
    await mkdir(join(root, 'Minis'));
    await writeFile(join(root, 'b.gcode'), '');
    await writeFile(join(root, 'notes.txt'), '');
    await writeFile(join(root, 'Minis', 'a.GCODE'), '');
    await symlink(root, join(root, 'loop'), 'junction').catch(() => undefined);
    assert.deepEqual(await findGcodes(root), ['Minis/a.GCODE', 'b.gcode']);
    assert.deepEqual(await findGcodes(root, 'Minis'), ['Minis/a.GCODE']);
    await assert.rejects(findGcodes(root, '..'), /inside/);
    await assert.rejects(findGcodes(root, join(root, '..')), /inside/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
