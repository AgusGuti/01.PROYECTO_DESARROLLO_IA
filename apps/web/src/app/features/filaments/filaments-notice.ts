/**
 * A one-off message handed from the form page to the list page through the router's navigation
 * state, so the list can confirm what just happened without the two pages sharing a service.
 * "Deleted" and "consumed" happen on the list itself and need no hand-over.
 */
export type FilamentsNotice = 'created' | 'updated' | 'gone';

export const NOTICE_TEXT: Readonly<Record<FilamentsNotice | 'deleted', string>> = {
  created: 'El filamento se creó correctamente.',
  updated: 'Los cambios se guardaron correctamente.',
  deleted: 'El filamento se eliminó correctamente.',
  gone: 'El filamento ya no existe.',
};

export function consumedText(grams: number): string {
  return `Se descontaron ${String(grams)} g.`;
}

export function noticeState(notice: FilamentsNotice): { readonly notice: FilamentsNotice } {
  return { notice };
}

/** Navigation state is untrusted input like any other: narrow it before use. */
export function readNotice(state: unknown): FilamentsNotice | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null;
  const { notice } = state;
  return notice === 'created' || notice === 'updated' || notice === 'gone' ? notice : null;
}
