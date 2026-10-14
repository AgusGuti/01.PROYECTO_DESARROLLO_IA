// Maps internal results to the public DTOs. Clients only ever see what a mapper returns,
// so internal fields cannot leak by accident (standard §6.2).
import type { LivenessDto, ReadinessDto } from './health.schemas.js';
import type { Liveness, Readiness } from './health.service.js';

export function toLivenessDto(liveness: Liveness): LivenessDto {
  return {
    status: liveness.status,
    uptimeSeconds: liveness.uptimeSeconds,
    timestamp: liveness.timestamp.toISOString(),
  };
}

export function toReadinessDto(readiness: Readiness): ReadinessDto {
  return {
    status: readiness.status,
    checks: { database: readiness.checks.database },
    timestamp: readiness.timestamp.toISOString(),
  };
}
