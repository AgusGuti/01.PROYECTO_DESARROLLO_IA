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
    path: 'filamentos',
    title: 'Filamentos · Print3D Planner',
    loadComponent: () =>
      import('./features/filaments/filaments-list-page').then((module) => module.FilamentsListPage),
  },
  {
    path: 'filamentos/nuevo',
    title: 'Nuevo filamento · Print3D Planner',
    loadComponent: () =>
      import('./features/filaments/filament-form-page').then((module) => module.FilamentFormPage),
  },
  {
    path: 'filamentos/:id/editar',
    title: 'Editar filamento · Print3D Planner',
    loadComponent: () =>
      import('./features/filaments/filament-form-page').then((module) => module.FilamentFormPage),
  },
  {
    path: 'piezas',
    title: 'Piezas · Print3D Planner',
    loadComponent: () =>
      import('./features/parts/parts-list-page').then((module) => module.PartsListPage),
  },
  {
    path: 'piezas/nueva',
    title: 'Nueva pieza · Print3D Planner',
    loadComponent: () =>
      import('./features/parts/part-form-page').then((module) => module.PartFormPage),
  },
  {
    path: 'piezas/:id/editar',
    title: 'Editar pieza · Print3D Planner',
    loadComponent: () =>
      import('./features/parts/part-form-page').then((module) => module.PartFormPage),
  },
  {
    path: 'proyectos',
    title: 'Proyectos · Print3D Planner',
    loadComponent: () =>
      import('./features/projects/projects-list-page').then((module) => module.ProjectsListPage),
  },
  {
    path: 'proyectos/nuevo',
    title: 'Nuevo proyecto · Print3D Planner',
    loadComponent: () =>
      import('./features/projects/project-form-page').then((module) => module.ProjectFormPage),
  },
  {
    path: 'proyectos/:id/editar',
    title: 'Editar proyecto · Print3D Planner',
    loadComponent: () =>
      import('./features/projects/project-form-page').then((module) => module.ProjectFormPage),
  },
  {
    path: '**',
    title: 'Página no encontrada · Print3D Planner',
    loadComponent: () =>
      import('./features/not-found/not-found-page').then((module) => module.NotFoundPage),
  },
];
