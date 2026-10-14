import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((error: unknown) => {
  // The app could not start, so no Angular error handling exists yet: the console is all there is.
  console.error(error);
});
