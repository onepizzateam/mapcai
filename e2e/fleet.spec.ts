import { test, expect } from '@playwright/test';

const bins = [
  { id: 'bin_delhi', lat: 28.61, lng: 77.21, vehicle_count: 1200, avg_soh: 94, open_exceptions: 8, region: 'Delhi NCR' },
  { id: 'bin_mumbai', lat: 19.07, lng: 72.87, vehicle_count: 800, avg_soh: 78, open_exceptions: 20, region: 'Mumbai' },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/bins', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bins, regions: [
    { name: 'Delhi NCR', vehicle_count: 1200, alerts_per_1k: 6.7, share_pct: 60 },
    { name: 'Mumbai', vehicle_count: 800, alerts_per_1k: 25, share_pct: 40 },
  ], meta: { total_vehicles: 2000, last_updated: Date.now() } }) }));
  await page.route('**/api/bin/bin_delhi', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bin: bins[0], trend: Array.from({ length: 24 }, (_, i) => ({ hour: i, avg_soh: 92 + i / 12 })), vehicles: [
    { id: 'EV-LOW', model: 'E2', soc: 9, status: 'driving', soh: 88, bin: 'bin_delhi', lat: 28.61, lng: 77.21 },
    { id: 'EV-OK', model: 'E4', soc: 72, status: 'charging', soh: 96, bin: 'bin_delhi', lat: 28.61, lng: 77.21 },
  ] }) }));
  await page.route('**/api/stream', async (route) => route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: `event: snapshot\ndata: ${JSON.stringify({ bins, regions: [], meta: { total_vehicles: 2000, last_updated: Date.now() } })}\n\n` }));
});

test('loads overview, filters a region, and drills into a bin', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Fleet overview' })).toBeVisible();
  await expect(page.getByText('2,000')).toBeVisible();
  await page.getByRole('button', { name: 'Delhi NCR' }).first().click();
  await expect(page.getByRole('button', { name: 'Delhi NCR' }).first()).toHaveAttribute('aria-pressed', 'true');
  const hex = page.locator('path.hex').first();
  await expect(hex).toBeVisible();
  await hex.click();
  await expect(page.getByText('bin_delhi')).toBeVisible();
  await expect(page.getByText('EV-LOW')).toBeVisible();
});

test('shows an actionable empty-store state', async ({ page }) => {
  await page.route('**/api/bins', async (route) => route.fulfill({ status: 503, body: JSON.stringify({ error: 'Fleet data store not configured' }) }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Fleet data is unavailable');
});
