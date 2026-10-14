// Application service: knows nothing about HTTP or MongoDB (standard §1.1).
// It depends on small interfaces; the real implementations are passed in from outside.

/** Anything the API needs in order to serve traffic, reduced to one question. */
export interface DependencyProbe {
  ping(): Promise<boolean>;
}

/** Injected so tests control time instead of depending on the wall clock (standard §10.3). */
export interface Clock {
  now(): Date;
}

export interface Liveness {
  readonly status: 'ok';
  readonly uptimeSeconds: number;
  readonly timestamp: Date;
}

export interface Readiness {
  readonly status: 'ready' | 'not_ready';
  readonly checks: { readonly database: 'up' | 'down' };
  readonly timestamp: Date;
}

export interface HealthService {
  /** Liveness: the process is running. Must not touch any dependency. */
  liveness(): Liveness;
  /** Readiness: the process can serve traffic right now. */
  readiness(): Promise<Readiness>;
}

export function createHealthService(deps: {
  database: DependencyProbe;
  clock: Clock;
}): HealthService {
  const startedAt = deps.clock.now();

  return {
    liveness() {
      const now = deps.clock.now();
      return {
        status: 'ok',
        uptimeSeconds: Math.floor((now.getTime() - startedAt.getTime()) / 1000),
        timestamp: now,
      };
    },

    async readiness() {
      const databaseUp = await deps.database.ping();
      return {
        status: databaseUp ? 'ready' : 'not_ready',
        checks: { database: databaseUp ? 'up' : 'down' },
        timestamp: deps.clock.now(),
      };
    },
  };
}
