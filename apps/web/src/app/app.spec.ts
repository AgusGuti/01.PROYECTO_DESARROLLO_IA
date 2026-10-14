import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([])] });
  });

  it('renders the application name', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.app-name')?.textContent).toContain('Print3D Planner');
  });

  it('offers a skip link that targets the main landmark', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const target = element.querySelector('.skip-link')?.getAttribute('href');
    expect(target).toBe('#contenido');
    expect(element.querySelector('main')?.id).toBe('contenido');
  });
});
