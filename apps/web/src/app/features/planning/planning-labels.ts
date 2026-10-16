/** 50 % is the API's ceiling for the batching saving (ADR 0027). */
export const MAX_SAVING_BASIS_POINTS = 5000;

const PERCENT_INPUT = /^(\d{1,2})(?:[,.](\d{1,2}))?$/;

/**
 * "12,5" becomes 1250. Only string and integer arithmetic, never `parseFloat * 100`; null when the
 * text is not a percentage from 0 to 50 with at most 2 decimals. A comma or a dot is accepted.
 */
export function parsePercentToBasisPoints(text: string): number | null {
  const match = PERCENT_INPUT.exec(text.trim());
  if (match === null) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints <= MAX_SAVING_BASIS_POINTS ? basisPoints : null;
}

/** The inverse, for filling the form: 1250 becomes "12,5", 5000 "50", 1 "0,01". */
export function basisPointsToPercentInput(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = String(basisPoints % 100).padStart(2, '0');
  return fraction === '00' ? String(whole) : `${String(whole)},${fraction.replace(/0$/, '')}`;
}
