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
    path: 'impresoras',
    title: 'Impresoras · Print3D Planner',
    loadComponent: () =>
      import('./features/printers/printers-list-page').then((module) => module.PrintersListPage),
  },
  {
    path: 'impresoras/nueva',
    title: 'Nueva impresora · Print3D Planner',
    loadComponent: () =>
      import('./features/printers/printer-form-page').then((module) => module.PrinterFormPage),
  },
  {
    path: 'impresoras/:id/editar',
    title: 'Editar impresora · Print3D Planner',
    loadComponent: () =>
      import('./features/printers/printer-form-page').then((module) => module.PrinterFormPage),
  },
  {
    path: '**',
    title: 'Página no encontrada · Print3D Planner',
    loadComponent: () =>
      import('./features/not-found/not-found-page').then((module) => module.NotFoundPage),
  },
];
