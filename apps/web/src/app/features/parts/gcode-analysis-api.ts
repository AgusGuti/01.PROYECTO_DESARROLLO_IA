import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { AnalyzeGcodeRequest, GcodeAnalysis, Material } from '@print3d/api-contracts';
import { map, type Observable } from 'rxjs';
import { API_BASE_URL } from '../../core/api/api-config';
import { isGcodeWarningCode } from './part-labels';
import { isRecord, isWholeNumber, narrow } from './parts-api';

function isNullOrWhole(value: unknown): boolean {
  return value === null || isWholeNumber(value);
}

function isNullOrDimensions(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      isWholeNumber(value['x']) &&
      isWholeNumber(value['y']) &&
      isWholeNumber(value['z']))
  );
}

/** Runtime check of the analysis; an unknown warning code is rejected so none goes unlabelled. */
export function isGcodeAnalysis(value: unknown): value is GcodeAnalysis {
  if (!isRecord(value)) return false;
  return (
    value['slicer'] === 'cura' &&
    isWholeNumber(value['estimatedPrintSeconds']) &&
    typeof value['filamentMm'] === 'number' &&
    Number.isFinite(value['filamentMm']) &&
    isNullOrWhole(value['filamentGrams']) &&
    isNullOrWhole(value['layerHeightUm']) &&
    isNullOrDimensions(value['dimensionsMm']) &&
    (value['targetMachineName'] === null || typeof value['targetMachineName'] === 'string') &&
    Array.isArray(value['warnings']) &&
    value['warnings'].every(
      (warning: unknown) => isRecord(warning) && isGcodeWarningCode(warning['code']),
    )
  );
}

@Injectable({ providedIn: 'root' })
export class GcodeAnalysisApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /**
   * Sends the first 64 KB of a .gcode file for analysis (ADR 0014). Stateless on the server and
   * a POST, so it is never retried automatically. `head` goes untrimmed, exactly as read.
   */
  analyse(head: string, material?: Material): Observable<GcodeAnalysis> {
    const body: AnalyzeGcodeRequest = material === undefined ? { head } : { head, material };
    return this.http
      .post<unknown>(`${this.baseUrl}/api/v1/gcode-analyses`, body)
      .pipe(map(narrow(isGcodeAnalysis)));
  }
}
