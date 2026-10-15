/**
 * A one-off message handed from the form page to the list page through the router's navigation
 * state, so the list can confirm what just happened without the two pages sharing a service.
 * "Deleted" happens on the list itself and needs no hand-over.
 */
export type ProjectsNotice = 'created' | 'updated' | 'gone';

export const NOTICE_TEXT: Readonly<Record<ProjectsNotice | 'deleted', string>> = {
  created: 'El proyecto se creó correctamente.',
  updated: 'Los cambios se guardaron correctamente.',
  deleted: 'El proyecto se eliminó correctamente.',
  gone: 'El proyecto ya no existe.',
};

export function noticeState(notice: ProjectsNotice): { readonly notice: ProjectsNotice } {
  return { notice };
}

/** Navigation state is untrusted input like any other: narrow it before use. */
export function readNotice(state: unknown): ProjectsNotice | null {
  if (typeof state !== 'object' || state === null || !('notice' in state)) return null;
  const { notice } = state;
  return notice === 'created' || notice === 'updated' || notice === 'gone' ? notice : null;
}
