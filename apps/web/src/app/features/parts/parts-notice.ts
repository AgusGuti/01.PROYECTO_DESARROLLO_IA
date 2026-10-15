/**
 * A one-off message handed from the form page to the list page through the router's navigation
 * state, so the list can confirm what just happened without the two pages sharing a service.
 * "Deleted" happens on the list itself and needs no hand-over.
 */
export type PartsNotice = 'created' | 'updated' | 'gone';

export const NOTICE_TEXT: Readonly<Record<PartsNotice | 'deleted', string>> = {
  created: 'La pieza se creó correctamente.',
  updated: 'Los cambios se guardaron correctamente.',
  deleted: 'La pieza se eliminó correctamente.',
  gone: 'La pieza ya no existe.',
};

export function noticeState(notice: PartsNotice): { readonly notice: PartsNotice } {
  return { notice };
}

/** Navigation state is untrusted input like any other: narrow it before use. */
export function readNotice(state: unknown): PartsNotice | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null;
  const { notice } = state;
  return notice === 'created' || notice === 'updated' || notice === 'gone' ? notice : null;
}
