import { expect, test } from '@playwright/test';

/**
 * End-to-end check: the browser can reach the API through nginx, create an
 * item, and see it in the list.
 *
 * One flow, wired correctly, is the bar. Shallow coverage in e2e produces
 * shallow confidence -- a green Playwright run that exercised a single happy
 * path is worth less than a failing one that points at the broken seam.
 */

test.describe('items', () => {
  test('create + list through nginx', async ({ page, request }) => {
    // 1. The web tier loads.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /hackathon/i })).toBeVisible();

    // 2. The API is reachable through the same origin (no CORS dance).
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });

    // 3. The ready probe is green too -- it depends on the database, so a
    //    pass here proves the whole stack is wired up.
    const ready = await request.get('/api/ready');
    expect(ready.status()).toBe(200);

    // 4. Create a uniquely named item via the API.
    const unique = `e2e-apple-${Date.now()}`;
    const create = await request.post('/api/items', { data: { name: unique, quantity: 1 } });
    expect(create.status()).toBe(201);
    const created = await create.json();
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.name).toBe(unique);

    // 5. The list now contains it.
    const list = await request.get('/api/items?limit=100');
    expect(list.status()).toBe(200);
    const items = (await list.json()).items as Array<{ id: string; name: string }>;
    expect(items.find((i) => i.id === created.id)).toBeTruthy();

    // 6. And the web app shows it.
    await page.reload();
    await expect(page.getByText(unique)).toBeVisible();
  });

  test('error envelope on a validation failure', async ({ request }) => {
    // A request that is wrong at the boundary must produce the documented
    // envelope. A 500 here would mean the zod gate is bypassed.
    const res = await request.post('/api/items', { data: { quantity: -1 } });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(typeof body.error.requestId).toBe('string');
  });
});