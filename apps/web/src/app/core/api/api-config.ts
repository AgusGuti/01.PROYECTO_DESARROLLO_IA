import { InjectionToken } from '@angular/core';

/** Base URL of the REST API. Provided once in app.config.ts from the environment file. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');
