import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

// Journeys of ADR 0036 (setup times and a spool on every line). Data is seeded through the API
// with names unique to each run, so the tests are repeatable and independent of each other.

const API = '/api/v1';
let counter = 0;
const unique = (label: string): string =>
  `E2E ${label} ${Date.now().toString(36)}${(counter++).toString()}`;

interface Created {
  id: string;
  version?: number;
}

async function post(request: APIRequestContext, path: string, data: object): Promise<Created> {
  const response = await request.post(`${API}${path}`, { data });
  expect(response.status(), `POST ${path}`).toBe(201);
  return (await response.json()) as Created;
}

const spool = (request: APIRequestContext, brand: string) =>
  post(request, '/filaments', {
    brand,
    material: 'PLA',
    colorName: 'Rojo',
    initialGrams: 1000,
    purchaseCostMinor: 2000000,
    purchaseDate: '2026-01-01',
  });

async function seed(request: APIRequestContext) {
  const spoolA = unique('Bobina A');
  const spoolB = unique('Bobina B');
  const [a, b] = [await spool(request, spoolA), await spool(request, spoolB)];
  const part = await post(request, '/parts', {
    name: unique('Pieza'),
    material: 'PLA',
    dimensionsMm: { x: 20, y: 20, z: 20 },
    estimatedWeightGrams: 10,
    estimatedPrintSeconds: 3600,
    layerHeightUm: 200,
  });
  const printer = await post(request, '/printers', {
    name: unique('Impresora'),
    buildVolume: { x: 220, y: 220, z: 250 },
    nozzle: { diameterMm: 0.4, material: 'brass' },
    compatibleMaterials: ['PLA'],
  });
  return { spoolA, spoolB, a, b, part, printer };
}

async function cleanup(request: APIRequestContext, ids: Record<string, string | undefined>) {
  // Best effort, children first; a failure here must not hide the result of the test.
  const { projectId, partId, printerId, spoolIds } = ids;
  if (projectId) {
    const queue = await request.get(`${API}/queues/${projectId}`);
    if (queue.ok()) {
      const { version } = (await queue.json()) as { version: number };
      await request.delete(`${API}/queues/${projectId}?version=${String(version)}`);
    }
    await request.delete(`${API}/projects/${projectId}`);
  }
  if (partId) await request.delete(`${API}/parts/${partId}`);
  if (printerId) await request.delete(`${API}/printers/${printerId}`);
  for (const id of (spoolIds ?? '').split(',').filter(Boolean)) {
    await request.delete(`${API}/filaments/${id}`);
  }
}

test('the simulation shows the spools and counts the preparation of a spool change', async ({
  page,
  request,
}) => {
  const { spoolA, spoolB, a, b, part, printer } = await seed(request);
  const project = await post(request, '/projects', {
    name: unique('Proyecto'),
    items: [
      { partId: part.id, filamentId: a.id, quantity: 1 },
      { partId: part.id, filamentId: b.id, quantity: 1 },
    ],
  });
  await post(request, '/queues', {
    projectId: project.id,
    goal: 'fastest',
    mode: 'single',
    printerIds: [printer.id],
  });
  const current = await request.get(`${API}/planning/settings`);
  const settings = (await current.json()) as {
    batchSavingBasisPoints: number;
    printerTurnaroundMinutes: number;
    filamentChangeMinutes: number;
    version: number;
  };
  const saved = await request.put(`${API}/planning/settings`, {
    data: {
      batchSavingBasisPoints: settings.batchSavingBasisPoints,
      printerTurnaroundMinutes: 10,
      filamentChangeMinutes: 30,
      version: settings.version,
    },
  });
  expect(saved.status()).toBe(200);

  try {
    await page.goto(`/proyectos/${project.id}/simulacion`);
    await page.getByRole('button', { name: 'Simular', exact: true }).click();

    await expect(page.getByRole('heading', { level: 2, name: 'Resultado' })).toBeVisible();
    await expect(page.getByRole('cell', { name: spoolA })).toBeVisible();
    await expect(page.getByRole('cell', { name: spoolB })).toBeVisible();
    await expect(page.getByRole('cell', { name: '40 min (cambio de bobina)' })).toBeVisible();
    const totals = page.locator('#summary');
    await expect(totals.locator('div', { hasText: 'Preparación total' })).toContainText('40 min');
    await expect(totals.locator('div', { hasText: 'Cambios de bobina' })).toContainText('1');
  } finally {
    // Put the user's own setup times back (a full replace, so read the newest version first).
    const latest = (await (await request.get(`${API}/planning/settings`)).json()) as {
      version: number;
    };
    await request.put(`${API}/planning/settings`, {
      data: {
        batchSavingBasisPoints: settings.batchSavingBasisPoints,
        printerTurnaroundMinutes: settings.printerTurnaroundMinutes,
        filamentChangeMinutes: settings.filamentChangeMinutes,
        version: latest.version,
      },
    });
    await cleanup(request, {
      projectId: project.id,
      partId: part.id,
      printerId: printer.id,
      spoolIds: `${a.id},${b.id}`,
    });
  }
});

test('a queue whose spool was deleted holds the save until another spool is chosen', async ({
  page,
  request,
}) => {
  const { spoolB, a, b, part, printer } = await seed(request);
  const project = await post(request, '/projects', {
    name: unique('Proyecto'),
    items: [{ partId: part.id, filamentId: a.id, quantity: 2 }],
  });
  await post(request, '/queues', {
    projectId: project.id,
    goal: 'fastest',
    mode: 'single',
    printerIds: [printer.id],
  });
  expect((await request.delete(`${API}/filaments/${a.id}`)).status()).toBe(204);

  try {
    await page.goto(`/proyectos/${project.id}/cola`);

    await expect(page.getByText('La bobina de esta línea ya no existe.')).toBeVisible();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Elegí una bobina para esta línea.')).toBeVisible();

    await page.getByRole('button', { name: /Elegir otra bobina/ }).focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Elegir otra bobina' });
    await dialog
      .getByLabel('Bobina')
      .selectOption({ label: `${spoolB} · Rojo · PLA · 1000 g disponibles` });
    await dialog.getByRole('button', { name: 'Elegir bobina' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: 'Guardar cambios' }).click();

    await expect(page.getByText('Los cambios se guardaron.')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const queue = (await (await request.get(`${API}/queues/${project.id}`)).json()) as {
      lines: { filamentId: string }[];
    };
    expect(queue.lines.map((line) => line.filamentId)).toEqual([b.id]);
  } finally {
    await cleanup(request, {
      projectId: project.id,
      partId: part.id,
      printerId: printer.id,
      spoolIds: b.id,
    });
  }
});
