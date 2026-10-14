// Production settings. `ng serve` swaps this file for environment.development.ts.
// Nothing here is secret: everything in a frontend bundle is public (standard §9.4).
export const environment = {
  production: true,
  /** Empty = same origin; the web server forwards /api and /health to the API. */
  apiBaseUrl: '',
};
