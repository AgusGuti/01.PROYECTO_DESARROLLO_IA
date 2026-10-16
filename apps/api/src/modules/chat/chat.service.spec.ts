import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors/app-error.js';
import { MAX_REPLY_CHARACTERS } from './chat.schemas.js';
import {
  AssistantMessageTooLongError,
  createChatService,
  type AssistantClient,
} from './chat.service.js';

function setup(client: AssistantClient) {
  const lines: unknown[] = [];
  const logger = pino({ level: 'info' }, { write: (line: string) => void lines.push(line) });
  return { lines, service: createChatService({ assistantClient: client, logger, now: () => 0 }) };
}

const failing = (error: Error): AssistantClient => ({ ask: () => Promise.reject(error) });

describe('chat service', () => {
  it('returns the reply and logs sizes, never the text', async () => {
    const { service, lines } = setup({ ask: () => Promise.resolve({ reply: 'respuesta' }) });

    await expect(service.ask('mensaje secreto')).resolves.toEqual({
      reply: 'respuesta',
      proposal: null,
    });

    const logged = lines.join('');
    expect(logged).toContain('"messageLength":15');
    expect(logged).not.toContain('mensaje secreto');
    expect(logged).not.toContain('respuesta');
  });

  it('turns a 413 from the assistant into a 400 on message', async () => {
    const { service } = setup(failing(new AssistantMessageTooLongError()));

    const error = await service.ask('x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'validation_failed',
      issues: [{ path: 'message', message: 'The message is too long.' }],
    });
  });

  it.each([
    ['unreachable', new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:8000')],
    ['a timeout', new DOMException('timed out', 'TimeoutError')],
    ['a malformed reply', new Error('Invalid input: expected string')],
  ])('answers a generic 503 on %s without leaking the cause', async (_name, cause) => {
    const { service } = setup(failing(cause));

    const error = await service.ask('x').catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'service_unavailable' });
    expect((error as AppError).message).not.toMatch(/ECONNREFUSED|timed out|expected string/);
  });

  it('rejects a reply over the cap and accepts one exactly at it', async () => {
    const over = setup({
      ask: () => Promise.resolve({ reply: 'a'.repeat(MAX_REPLY_CHARACTERS + 1) }),
    });
    const at = setup({ ask: () => Promise.resolve({ reply: 'a'.repeat(MAX_REPLY_CHARACTERS) }) });

    await expect(over.service.ask('x')).rejects.toMatchObject({ code: 'service_unavailable' });
    await expect(at.service.ask('x')).resolves.toMatchObject({
      reply: expect.stringMatching(/^a{10000}$/) as string,
    });
  });

  describe('proposal', () => {
    const partId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const valid = {
      kind: 'create_project',
      payload: { name: 'Soportes', items: [{ partId: partId.toUpperCase(), quantity: 2 }] },
      itemNames: [{ partId, name: 'Soporte' }],
    };

    it('passes a valid proposal through, ids lower-cased', async () => {
      const { service, lines } = setup({
        ask: () => Promise.resolve({ reply: 'Te propongo esto', proposal: valid }),
      });

      const result = await service.ask('crea un proyecto');

      expect(result.proposal).toEqual({
        ...valid,
        payload: { name: 'Soportes', items: [{ partId, quantity: 2 }] },
      });
      expect(lines.join('')).toContain('"proposal":"valid"');
    });

    it.each([
      ['an unknown key', { ...valid, extra: 1 }],
      ['an unknown payload key', { ...valid, payload: { ...valid.payload, status: 'done' } }],
      ['another kind', { ...valid, kind: 'delete_project' }],
      [
        'a name for a part not in the items',
        { ...valid, itemNames: [{ partId: 'b'.repeat(24), name: 'x' }] },
      ],
      ['not an object', 'create a project'],
    ])('drops %s but keeps the reply and logs no content', async (_name, proposal) => {
      const { service, lines } = setup({
        ask: () => Promise.resolve({ reply: 'Hola', proposal }),
      });

      await expect(service.ask('x')).resolves.toEqual({ reply: 'Hola', proposal: null });
      expect(lines.join('')).toContain('"proposal":"dropped"');
      expect(lines.join('')).not.toContain('delete_project');
    });

    it('answers null when the assistant sends no proposal or null', async () => {
      const absent = setup({ ask: () => Promise.resolve({ reply: 'a' }) });
      const nul = setup({ ask: () => Promise.resolve({ reply: 'a', proposal: null }) });

      await expect(absent.service.ask('x')).resolves.toEqual({ reply: 'a', proposal: null });
      await expect(nul.service.ask('x')).resolves.toEqual({ reply: 'a', proposal: null });
    });
  });
});
