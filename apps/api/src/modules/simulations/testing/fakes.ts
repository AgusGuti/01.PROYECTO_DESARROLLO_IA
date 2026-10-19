// Test doubles for the simulations module: the five read ports over in-memory data.
import type { ScheduleRules } from '../../availability/index.js';
import type {
  Goal,
  PartData,
  PartLookup,
  PlanningReader,
  PrinterData,
  PrinterLookup,
  ProjectReader,
  QueueReader,
  ScheduleReader,
} from '../simulations.service.js';

export const PROJECT_ID = '1'.repeat(24);
export const PART_A = 'a'.repeat(24);
export const PART_B = 'b'.repeat(24);
export const PRINTER_1 = 'd'.repeat(24);
export const PRINTER_2 = 'e'.repeat(24);

/** Every day 08:00-18:00, the same as the defaults of the availability module. */
export const DAY_SHIFT: ScheduleRules = {
  weekly: Array.from({ length: 7 }, () => ({ ranges: [{ startMinute: 480, endMinute: 1080 }] })),
  exceptions: [],
  absences: [],
};

/** Ender-3 V2 Neo bed. */
export const ENDER_BED = { x: 220, y: 220, z: 250 };
/** Too big to share a plate (210 + 10 = 220 fills a side): batching never applies by default. */
export const BIG_PART = { x: 210, y: 100, z: 50 };

export type Failing = 'queue' | 'project' | 'parts' | 'printers' | 'schedule' | 'planning';

export interface FakePorts {
  readonly queueReader: QueueReader;
  readonly projectReader: ProjectReader;
  readonly partLookup: PartLookup;
  readonly printerLookup: PrinterLookup;
  readonly scheduleReader: ScheduleReader;
  readonly planningReader: PlanningReader;
  /** project id -> queue. Anything else has no queue. */
  readonly queues: Map<
    string,
    {
      goal: Goal;
      mode: 'single' | 'multi';
      printerIds: string[];
      lines: { partId: string; quantity: number; completed: number }[];
    }
  >;
  /** project id -> deadline. Anything else is unknown or removed. */
  readonly projects: Map<string, string | null>;
  readonly parts: Map<string, PartData>;
  /** Live, not archived printers. */
  readonly printers: Map<string, PrinterData>;
  schedule: ScheduleRules & { version: number };
  batchSavingBasisPoints: number;
  /** When set, the named port rejects with this error (a dependency failure). */
  failing: Failing | undefined;
}

/** The entries of `source` whose key is among `ids`. */
function only<T>(source: ReadonlyMap<string, T>, ids: readonly string[]): Map<string, T> {
  return new Map([...source].filter(([id]) => ids.includes(id)));
}

export function createFakePorts(): FakePorts {
  const fail = (which: Failing): void => {
    if (ports.failing === which) throw new Error('boom: secret driver text');
  };
  const ports: FakePorts = {
    queues: new Map([
      [
        PROJECT_ID,
        {
          goal: 'fastest',
          mode: 'single',
          printerIds: [PRINTER_1],
          lines: [{ partId: PART_A, quantity: 3, completed: 0 }],
        },
      ],
    ]),
    projects: new Map([[PROJECT_ID, null]]),
    // 2 hours per unit.
    parts: new Map([
      [PART_A, { name: 'Soporte en L', estimatedPrintSeconds: 7200, dimensionsMm: BIG_PART }],
      [PART_B, { name: 'Florero', estimatedPrintSeconds: 3600, dimensionsMm: BIG_PART }],
    ]),
    printers: new Map([
      [PRINTER_1, { name: 'Ender 3', buildVolume: ENDER_BED }],
      [PRINTER_2, { name: 'Prusa', buildVolume: ENDER_BED }],
    ]),
    schedule: { ...DAY_SHIFT, version: 1 },
    batchSavingBasisPoints: 0,
    failing: undefined,

    queueReader(id) {
      fail('queue');
      return Promise.resolve(ports.queues.get(id) ?? null);
    },
    projectReader(id) {
      fail('project');
      const deadline = ports.projects.get(id);
      return Promise.resolve(deadline === undefined ? null : { deadline });
    },
    partLookup(ids) {
      fail('parts');
      return Promise.resolve(only(ports.parts, ids));
    },
    printerLookup(ids) {
      fail('printers');
      return Promise.resolve(only(ports.printers, ids));
    },
    scheduleReader() {
      fail('schedule');
      return Promise.resolve(ports.schedule);
    },
    planningReader() {
      fail('planning');
      return Promise.resolve({ batchSavingBasisPoints: ports.batchSavingBasisPoints });
    },
  };
  return ports;
}
