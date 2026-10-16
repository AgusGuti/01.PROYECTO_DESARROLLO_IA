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
    const { service, lines } = setup({ ask: () => Promise.resolve('respuesta') });

    await expect(service.ask('mensaje secreto')).resolves.toBe('respuesta');

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
    const over = setup({ ask: () => Promise.resolve('a'.repeat(MAX_REPLY_CHARACTERS + 1)) });
    const at = setup({ ask: () => Promise.resolve('a'.repeat(MAX_REPLY_CHARACTERS)) });

    await expect(over.service.ask('x')).rejects.toMatchObject({ code: 'service_unavailable' });
    await expect(at.service.ask('x')).resolves.toHaveLength(MAX_REPLY_CHARACTERS);
  });
});
