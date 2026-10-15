/**
 * A one-off message handed from the form page to the list page through the router's navigation
 * state, so the list can confirm what just happened without the two pages sharing a service.
 */
export type PrintersNotice = 'created' | 'restored' | 'updated' | 'gone';

export const NOTICE_TEXT: Readonly<Record<PrintersNotice, string>> = {
  created: 'La impresora se creó correctamente.',
  restored: 'La impresora se restauró con los datos nuevos.',
  updated: 'Los cambios se guardaron correctamente.',
  gone: 'La impresora ya no existe.',
};

export function noticeState(notice: PrintersNotice): { readonly notice: PrintersNotice } {
  return { notice };
}

/** Navigation state is untrusted input like any other: narrow it before use. */
export function readNotice(state: unknown): PrintersNotice | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null;
  const { notice } = state;
  return notice === 'created' || notice === 'restored' || notice === 'updated' || notice === 'gone'
    ? notice
    : null;
}
