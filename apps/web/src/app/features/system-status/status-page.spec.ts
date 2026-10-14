import { TestBed } from '@angular/core/testing';
import type { Readiness } from '@print3d/api-contracts';
import { type Observable, of, Subject, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api-error';
import { StatusApi } from './status-api';
import { StatusPage } from './status-page';

const ready: Readiness = {
  status: 'ready',
  checks: { database: 'up' },
  timestamp: '2026-01-01T12:00:00.000Z',
};

async function render(readiness: () => Observable<Readiness>) {
  TestBed.configureTestingModule({
    imports: [StatusPage],
    providers: [{ provide: StatusApi, useValue: { readiness } }],
  });
  const fixture = TestBed.createComponent(StatusPage);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    text: () => element.textContent,
    button: () => element.querySelector('button'),
    alert: () => element.querySelector('[role="alert"]'),
  };
}

describe('StatusPage', () => {
  it('shows a loading message and disables the button while waiting', async () => {
    const page = await render(() => new Subject<Readiness>());

    expect(page.text()).toContain('Consultando el estado');
    expect(page.button()?.disabled).toBe(true);
  });

  it('shows that everything works when the API is ready', async () => {
    const page = await render(() => of(ready));

    expect(page.text()).toContain('Todo funciona correctamente');
    expect(page.text()).toContain('Conectada');
    expect(page.button()?.disabled).toBe(false);
  });

  it('shows which dependency is down when the API is not ready', async () => {
    const page = await render(() =>
      of<Readiness>({ ...ready, status: 'not_ready', checks: { database: 'down' } }),
    );

    expect(page.text()).toContain('todavía no está listo');
    expect(page.text()).toContain('Sin conexión');
  });

  it('announces a safe error message when the request fails', async () => {
    const page = await render(() =>
      throwError(() => new ApiError(0, 'network_error', 'No se pudo conectar con el servidor.')),
    );

    expect(page.alert()?.textContent).toContain('No se pudo conectar con el servidor.');
  });

  it('asks again when the user presses the button', async () => {
    let calls = 0;
    const page = await render(() => {
      calls += 1;
      return of(ready);
    });

    page.button()?.click();
    await page.fixture.whenStable();

    expect(calls).toBe(2);
  });
});
