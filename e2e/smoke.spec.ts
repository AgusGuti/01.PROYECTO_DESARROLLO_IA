import { expect, test } from '@playwright/test';

test('the app loads and reports that the whole stack is healthy', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/estado$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Estado del sistema' })).toBeVisible();
  await expect(page.getByText('Todo funciona correctamente.')).toBeVisible();
  await expect(page.getByText('Conectada')).toBeVisible();
});

test('an unknown address shows the not-found page', async ({ page }) => {
  await page.goto('/no-existe');

  await expect(page.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeVisible();
});
