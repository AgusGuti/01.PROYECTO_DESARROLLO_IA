import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive the real stack: browser -> Angular -> Express -> MongoDB.
// Keep them few and reserved for critical user flows (standard §10.1).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4200',
    locale: 'es-AR',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:3000/health/live',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://127.0.0.1:4200',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
