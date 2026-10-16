import { describe, expect, it } from 'vitest';
import { chatRequestSchema } from './chat.schemas.js';

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
