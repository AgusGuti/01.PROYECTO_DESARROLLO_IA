import { describe, expect, it } from 'vitest';
import { stampSource } from './parts.domain.js';

const NOW = new Date('2026-03-01T10:00:00.000Z');

describe('stampSource', () => {
  it('keeps a manual source as it is', () => {
    expect(stampSource({ kind: 'manual' }, NOW)).toEqual({ kind: 'manual' });
  });

  it('adds analyzedAt from the given instant to a gcode source', () => {
    expect(stampSource({ kind: 'gcode', fileName: 'a.gcode', slicer: 'cura' }, NOW)).toEqual({
      kind: 'gcode',
      fileName: 'a.gcode',
      slicer: 'cura',
      analyzedAt: NOW,
    });
  });

  it('does not let an extra analyzedAt on the input through', () => {
    const hostile = {
      kind: 'gcode',
      fileName: 'a.gcode',
      slicer: 'cura',
      analyzedAt: new Date('1999-01-01T00:00:00.000Z'),
    } as const;

    expect(stampSource(hostile, NOW)).toHaveProperty('analyzedAt', NOW);
  });
});
