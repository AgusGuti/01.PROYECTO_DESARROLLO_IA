// The printers module's usage check, built from the queues repository (ADR 0032).
import { describe, expect, it } from 'vitest';
import { createPrinterUsageCheck } from './index.js';
import {
  createFakeQueueRepository,
  line,
  PART_A,
  PRINTER_1,
  PRINTER_2,
  PROJECT_ID,
  validFields,
} from './testing/fakes.js';

describe('createPrinterUsageCheck', () => {
  it('is true for a printer of a queue with pending work', async () => {
    const repository = createFakeQueueRepository();
    repository.seed(PROJECT_ID, validFields);

    expect(await createPrinterUsageCheck(repository)(PRINTER_1)).toBe(true);
  });

  it('is false for a finished queue and for a printer no queue selects', async () => {
    const repository = createFakeQueueRepository();
    repository.seed(PROJECT_ID, { ...validFields, lines: [line(PART_A, 4, 4)] });
    const check = createPrinterUsageCheck(repository);

    expect(await check(PRINTER_1)).toBe(false);
    expect(await check(PRINTER_2)).toBe(false);
  });

  it('rejects when the repository fails, so the caller can fail closed', async () => {
    const repository = createFakeQueueRepository();
    repository.failWith = new Error('down');

    await expect(createPrinterUsageCheck(repository)(PRINTER_1)).rejects.toThrow('down');
  });
});
