import type { Routes } from '@angular/router';

// Each feature is loaded on demand (`loadComponent`), which keeps the first download small.
// Route guards, when added, only improve the experience: the API enforces access (standard §8.1).
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'estado' },
  {
    path: 'estado',
    title: 'Estado del sistema · Print3D Planner',
    loadComponent: () =>
      import('./features/system-status/status-page').then((module) => module.StatusPage),
  },
  {
    path: '**',
    title: 'Página no encontrada · Print3D Planner',
    loadComponent: () =>
      import('./features/not-found/not-found-page').then((module) => module.NotFoundPage),
  },
];
