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

    expect(parsed.payload.items).toEqual([line(ID, 1)]);
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
