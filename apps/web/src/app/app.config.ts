import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import localeEsAr from '@angular/common/locales/es-AR';
import {
  type ApplicationConfig,
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { API_BASE_URL } from './core/api/api-config';
import { apiErrorInterceptor } from './core/api/api-error.interceptor';

// Dates and numbers are formatted for Argentina; the API always sends UTC instants.
registerLocaleData(localeEsAr);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([apiErrorInterceptor])),
    { provide: LOCALE_ID, useValue: 'es-AR' },
    { provide: API_BASE_URL, useValue: environment.apiBaseUrl },
  ],
};
