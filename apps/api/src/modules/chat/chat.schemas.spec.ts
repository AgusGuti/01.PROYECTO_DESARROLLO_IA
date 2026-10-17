import { describe, expect, it } from 'vitest';
import { chatRequestSchema, proposalSchema } from './chat.schemas.js';

const ID = 'a'.repeat(24);
const proposal = (payload: object = { name: 'Soportes' }, itemNames: unknown[] = []) => ({
  kind: 'create_project',
  payload,
  itemNames,
});
const line = (partId: string, quantity: number) => ({ partId, quantity });

describe('proposalSchema', () => {
  it.each([
    ['only a name', proposal()],
    [
      'every field',
      proposal(
        {
          name: 'N',
          description: 'D',
          priority: 'urgent',
          deadline: '2026-11-30',
          items: [line(ID, 1000)],
        },
        [{ partId: ID, name: 'Pieza' }],
      ),
    ],
    [
      '100 items',
      proposal({
        name: 'N',
        items: Array.from({ length: 100 }, (_v, i) => line(i.toString(16).padStart(24, '0'), 1)),
      }),
    ],
    ['a 100-character name', proposal({ name: 'a'.repeat(100) })],
    ['the first deadline year', proposal({ name: 'N', deadline: '2000-01-01' })],
  ])('accepts %s', (_name, input) => {
    expect(proposalSchema.safeParse(input).success).toBe(true);
  });

  it('lower-cases part ids', () => {
    const parsed = proposalSchema.parse(
      proposal({ name: 'N', items: [line(ID.toUpperCase(), 1)] }),
    );

    expect(parsed.kind === 'create_project' && parsed.payload.items).toEqual([line(ID, 1)]);
  });

  it.each([
    ['an unknown top-level key', { ...proposal(), extra: 1 }],
    ['another kind', { ...proposal(), kind: 'delete_project' }],
    ['no itemNames', { kind: 'create_project', payload: { name: 'N' } }],
    ['an unknown payload key', proposal({ name: 'N', status: 'done' })],
    ['an empty name', proposal({ name: '  ' })],
    ['a 101-character name', proposal({ name: 'a'.repeat(101) })],
    ['a control character in the name', proposal({ name: 'a\nb' })],
    ['a 1001-character description', proposal({ name: 'N', description: 'a'.repeat(1001) })],
    ['an unknown priority', proposal({ name: 'N', priority: 'asap' })],
    ['a non-date deadline', proposal({ name: 'N', deadline: '2026-02-30' })],
    ['a deadline out of range', proposal({ name: 'N', deadline: '2100-01-01' })],
    ['a bad part id', proposal({ name: 'N', items: [line('xyz', 1)] })],
    ['quantity 0', proposal({ name: 'N', items: [line(ID, 0)] })],
    ['quantity 1001', proposal({ name: 'N', items: [line(ID, 1001)] })],
    ['a fractional quantity', proposal({ name: 'N', items: [line(ID, 1.5)] })],
    ['an unknown item key', proposal({ name: 'N', items: [{ ...line(ID, 1), price: 1 }] })],
    [
      '101 items',
      proposal({
        name: 'N',
        items: Array.from({ length: 101 }, (_v, i) => line(i.toString(16).padStart(24, '0'), 1)),
      }),
    ],
    ['a repeated part', proposal({ name: 'N', items: [line(ID, 1), line(ID, 2)] })],
    ['a name for a part not in the items', proposal({ name: 'N' }, [{ partId: ID, name: 'x' }])],
    [
      'a 101-character item name',
      proposal({ name: 'N', items: [line(ID, 1)] }, [{ partId: ID, name: 'a'.repeat(101) }]),
    ],
    [
      'an item name with an unknown key',
      proposal({ name: 'N', items: [line(ID, 1)] }, [{ partId: ID, name: 'x', id: 1 }]),
    ],
  ])('rejects %s', (_name, input) => {
    expect(proposalSchema.safeParse(input).success).toBe(false);
  });
});

const P1 = 'b'.repeat(24);
const P2 = 'c'.repeat(24);
const queue = (payload: object = {}, extra: object = {}) => ({
  kind: 'create_queue',
  payload: { projectId: ID, goal: 'fastest', mode: 'single', printerIds: [P1], ...payload },
  projectName: 'Soportes',
  printerNames: [{ printerId: P1, name: 'Prusa' }],
  ...extra,
});
const ids = (n: number) => Array.from({ length: n }, (_v, i) => i.toString(16).padStart(24, '0'));
const none = { printerNames: [] };

describe('proposalSchema create_queue', () => {
  it.each([
    ['single with one printer', queue()],
    ['multi with two printers', queue({ mode: 'multi', printerIds: [P1, P2] }, none)],
    ['multi with ten printers', queue({ mode: 'multi', printerIds: ids(10) }, none)],
    ['goal deadline', queue({ goal: 'deadline' })],
    ['goal minimal_idle', queue({ goal: 'minimal_idle' })],
  ])('accepts %s', (_name, input) => {
    expect(proposalSchema.safeParse(input).success).toBe(true);
  });

  it('lower-cases ids', () => {
    const parsed = proposalSchema.parse(queue({ projectId: ID.toUpperCase() }));

    expect(parsed.kind === 'create_queue' && parsed.payload.projectId).toBe(ID);
  });

  it.each([
    ['an unknown top-level key', queue({}, { extra: 1 })],
    ['an unknown payload key', queue({ lines: [] })],
    ['a bad project id', queue({ projectId: 'xyz' })],
    ['a bad printer id', queue({ printerIds: ['xyz'] }, none)],
    ['an unknown goal', queue({ goal: 'cheapest' })],
    ['an unknown mode', queue({ mode: 'dual' })],
    ['single with two printers', queue({ printerIds: [P1, P2] }, none)],
    ['single with no printers', queue({ printerIds: [] }, none)],
    ['multi with one printer', queue({ mode: 'multi' })],
    ['multi with eleven printers', queue({ mode: 'multi', printerIds: ids(11) }, none)],
    ['a repeated printer', queue({ mode: 'multi', printerIds: [P1, P1] }, none)],
    [
      'a name for a printer not selected',
      queue({}, { printerNames: [{ printerId: P2, name: 'x' }] }),
    ],
    [
      'a repeated printer name',
      queue(
        {},
        {
          printerNames: [
            { printerId: P1, name: 'x' },
            { printerId: P1, name: 'y' },
          ],
        },
      ),
    ],
    ['no project name', queue({}, { projectName: undefined })],
    ['an empty project name', queue({}, { projectName: ' ' })],
    ['a 101-character project name', queue({}, { projectName: 'a'.repeat(101) })],
    ['a control character in the project name', queue({}, { projectName: 'a\nb' })],
    [
      'a 101-character printer name',
      queue({}, { printerNames: [{ printerId: P1, name: 'a'.repeat(101) }] }),
    ],
    [
      'a printer name with an unknown key',
      queue({}, { printerNames: [{ printerId: P1, name: 'x', id: 1 }] }),
    ],
    ['itemNames from the other kind', queue({}, { itemNames: [] })],
  ])('rejects %s', (_name, input) => {
    expect(proposalSchema.safeParse(input).success).toBe(false);
  });
});

describe('chatRequestSchema', () => {
  it.each([
    ['one character', 'a', 'a'],
    ['trims the ends', '  hola  ', 'hola'],
    ['exactly 2000 characters', 'a'.repeat(2000), 'a'.repeat(2000)],
    ['2000 characters plus padding', ` ${'a'.repeat(2000)} `, 'a'.repeat(2000)],
  ])('accepts %s', (_name, input, expected) => {
    expect(chatRequestSchema.parse({ message: input })).toEqual({ message: expected });
  });

  it.each([
    ['empty', { message: '' }],
    ['only whitespace', { message: ' \n\t ' }],
    ['2001 characters', { message: 'a'.repeat(2001) }],
    ['missing', {}],
    ['not a string', { message: 5 }],
    ['an unknown key', { message: 'hola', model: 'x' }],
  ])('rejects %s', (_name, input) => {
    expect(chatRequestSchema.safeParse(input).success).toBe(false);
  });
});
