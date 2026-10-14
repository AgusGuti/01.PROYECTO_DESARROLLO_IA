import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink],
  template: `
    <section aria-labelledby="not-found-title">
      <h1 id="not-found-title">Página no encontrada</h1>
      <p>La dirección que abriste no existe.</p>
      <a routerLink="/">Volver al inicio</a>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundPage {}
