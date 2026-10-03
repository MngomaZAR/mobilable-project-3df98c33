const { test, expect } = require('@playwright/test');

test.describe.configure({ timeout: 120000 });

const OPEN_FREE_MAP = 'https://tiles.openfreemap.org/**';
const ROUTING_ENDPOINT = /\/routing\/route(?:\?|$)/;
const DURBAN = { minLat: -30, maxLat: -29.7, minLng: 30.8, maxLng: 31.2 };
const inDurban = (latitude, longitude) => Number.isFinite(latitude) && Number.isFinite(longitude) &&
  latitude >= DURBAN.minLat && latitude <= DURBAN.maxLat && longitude >= DURBAN.minLng && longitude <= DURBAN.maxLng;
const distanceKm = (a, b) => {
  const radians = (degrees) => degrees * Math.PI / 180;
  const h = Math.sin(radians(b[1] - a[1]) / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(radians(b[0] - a[0]) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
};
const viewports = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
];

async function openOracleMap(page) {
  await page.context().setGeolocation({ latitude: -29.87, longitude: 31.04 });
  await page.context().grantPermissions(['geolocation']);
  // Keep these QA credentials away from any non-QA backend.
  await page.route(/https:\/\/.*(?:nip\.io|supabase\.co|nhost\.run)\//, (route) => route.abort());
  await page.goto('/');
  const caseIndex = [
    'Oracle map renders, navigates, selects and resizes on phone',
    'Oracle map renders, navigates, selects and resizes on desktop',
    'Oracle road route uses returned road geometry and clears on map press',
    'Oracle routing failure shows no invented line or ETA',
    'map tile failure is visible and retry replaces the failed map',
    'unsupported WebGL is reported honestly without an uncaught crash',
    'unknown, zero and outside-ZA provider locations never become map pins',
    'road geometry outside ZA or snapped far from the destination is rejected',
  ].indexOf(test.info().title);
  expect(caseIndex).toBeGreaterThanOrEqual(0);
  await page.getByPlaceholder('Email address').fill(`qa-client-${20 + caseIndex}@example.invalid`);
  await page.getByPlaceholder('Password').fill('QA-only-not-a-real-user-2026!');
  await page.getByText('Sign In', { exact: true }).last().click();
  await page.getByRole('tab', { name: /Map/ }).click({ timeout: 40000 });
  return page.getByRole('region', { name: 'Talent map', exact: true });
}

async function renderedColorCount(page, canvas) {
  const screenshot = await canvas.screenshot();
  // Decode the real canvas screenshot in the browser, not WebGL's discarded backbuffer.
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const sample = document.createElement('canvas');
    sample.width = image.width;
    sample.height = image.height;
    const context = sample.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, sample.width, sample.height);
    const colors = new Set();
    for (let y = Math.floor(sample.height * 0.2); y < sample.height * 0.7; y += 3) {
      for (let x = Math.floor(sample.width * 0.2); x < sample.width * 0.8; x += 3) {
        const index = (y * sample.width + x) * 4;
        colors.add(`${data[index] >> 3},${data[index + 1] >> 3},${data[index + 2] >> 3}`);
      }
    }
    return colors.size;
  }, screenshot.toString('base64'));
}

async function selectTalent(map) {
  const pins = map.locator('button[data-marker-type="photographer"], button[data-marker-type="model"]');
  await expect.poll(() => pins.count()).toBeGreaterThan(0);
  const locations = await pins.evaluateAll((elements) => elements.map((pin, index) => ({
    index, latitude: Number(pin.dataset.latitude), longitude: Number(pin.dataset.longitude),
  })));
  for (const location of locations) {
    expect(Number.isFinite(location.latitude) && Number.isFinite(location.longitude)).toBe(true);
    expect(location.latitude).toBeGreaterThanOrEqual(-35);
    expect(location.latitude).toBeLessThanOrEqual(-22);
    expect(location.longitude).toBeGreaterThanOrEqual(16);
    expect(location.longitude).toBeLessThanOrEqual(33);
  }
  const destination = locations.find((location) => inDurban(location.latitude, location.longitude));
  expect(destination, 'a known Durban provider, not a default origin pin').toBeDefined();
  const pin = pins.nth(destination.index);
  const label = await pin.getAttribute('aria-label');
  // Seeded QA accounts may share a coordinate; keyboard activation still reaches every pin.
  await pin.focus();
  await pin.press('Enter');
  await expect(map.getByRole('status').locator('strong')).toHaveText(label.split(',')[0]);
  return [destination.longitude, destination.latitude];
}

for (const viewport of viewports) {
  test(`Oracle map renders, navigates, selects and resizes on ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const crashes = [];
    let loadedTiles = 0;
    page.on('pageerror', (error) => crashes.push(error.message));
    page.on('response', (response) => {
      if (response.url().startsWith('https://tiles.openfreemap.org/') && /\.(?:pbf|mvt)(?:\?|$)/.test(response.url()) && response.ok()) loadedTiles++;
    });
    const map = await openOracleMap(page);
    for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
      const response = await page.request.get(`/maplibre/${file}`);
      expect(response.ok(), `${file} is served`).toBe(true);
      expect(response.headers()['content-type']).toMatch(/javascript/);
      expect(await response.text()).not.toMatch(/^\s*<!doctype/i);
    }
    await expect(map).toHaveAttribute('data-map-state', 'ready', { timeout: 40000 });
    const canvas = map.locator('canvas.maplibregl-canvas');
    await expect(canvas).toBeVisible();
    await expect.poll(() => loadedTiles, { timeout: 30000 }).toBeGreaterThan(0);
    await expect.poll(() => renderedColorCount(page, canvas)).toBeGreaterThan(16);
    await expect(map.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible();
    await expect(map.getByRole('button', { name: 'Zoom out', exact: true })).toBeVisible();
    await expect(map.getByRole('button', { name: 'Fit all map pins and route' })).toBeEnabled();
    await expect(map.getByText('OpenStreetMap', { exact: false }).first()).toBeAttached();

    await selectTalent(map);
    await expect(map.getByRole('status')).toContainText('Your location is needed for road directions.');
    await expect(map).toHaveAttribute('data-route-points', '0');
    // A blank-map press clears the selection, independently of marker activation.
    await canvas.click({ position: { x: 90, y: 90 } });
    await expect(map.getByRole('status').locator('strong')).toHaveCount(0);

    const beforeZoom = await canvas.screenshot();
    await map.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect.poll(async () => !(await canvas.screenshot()).equals(beforeZoom)).toBe(true);
    await map.getByRole('button', { name: 'Fit all map pins and route' }).click();
    await expect(map.locator('button[data-marker-type="photographer"], button[data-marker-type="model"]').last()).toBeInViewport();

    await page.setViewportSize({ width: viewport.name === 'phone' ? 768 : 390, height: 844 });
    await expect.poll(async () => {
      const mapBox = await map.boundingBox();
      const canvasBox = await canvas.boundingBox();
      return Math.abs(mapBox.width - canvasBox.width) < 2 && Math.abs(mapBox.height - canvasBox.height) < 2;
    }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`map-${viewport.name}-resized.png`), fullPage: true });
    expect(crashes).toEqual([]);
  });
}

test('Oracle road route uses returned road geometry and clears on map press', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const map = await openOracleMap(page);
  await expect(map).toHaveAttribute('data-map-state', 'ready', { timeout: 40000 });
  await map.getByRole('button', { name: 'Find my location', exact: true }).click();
  await expect(map.locator('button[data-marker-type="user"]')).toBeAttached({ timeout: 15000 });
  const roadResponse = page.waitForResponse((response) => ROUTING_ENDPOINT.test(response.url()));
  const destination = await selectTalent(map);
  const response = await roadResponse;
  expect(response.ok()).toBe(true);
  const road = await response.json();
  const request = new URL(response.url()).searchParams;
  const start = [Number(request.get('start_lng')), Number(request.get('start_lat'))];
  expect(inDurban(start[1], start[0])).toBe(true);
  expect(Number(request.get('end_lat'))).toBeCloseTo(destination[1], 5);
  expect(Number(request.get('end_lng'))).toBeCloseTo(destination[0], 5);
  expect(['osrm', 'ors']).toContain(road.source);
  expect(road.coordinates.length).toBeGreaterThan(2);
  expect(road.coordinates.every(([longitude, latitude]) => inDurban(latitude, longitude))).toBe(true);
  expect(distanceKm(start, road.coordinates[0])).toBeLessThan(1);
  expect(distanceKm(destination, road.coordinates[road.coordinates.length - 1])).toBeLessThan(1);
  expect(road.distance).toBeGreaterThan(0);
  expect(road.distance).toBeGreaterThanOrEqual(distanceKm(start, destination) * 0.9);
  expect(road.distance).toBeLessThan(50);
  expect(road.duration).toBeGreaterThan(0);
  expect(road.duration).toBeLessThan(7200);
  await expect(map).toHaveAttribute('data-route-state', 'ready');
  await expect(map).toHaveAttribute('data-route-points', String(road.coordinates.length));
  await expect(map.getByRole('status')).toContainText('Road route');
  const canvas = map.locator('canvas');
  await expect.poll(async () => {
    const raw = await canvas.getAttribute('data-map-bounds');
    if (!raw) return false;
    const [[west, south], [east, north]] = JSON.parse(raw);
    return east - west < 0.5 && north - south < 0.5 &&
      road.coordinates.every(([longitude, latitude]) => longitude >= west && longitude <= east && latitude >= south && latitude <= north);
  }, { message: 'Durban street context and the complete road route fit the viewport' }).toBe(true);
  await expect.poll(() => renderedColorCount(page, canvas)).toBeGreaterThan(16);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: testInfo.outputPath('map-road-route.png'), fullPage: true });
  await map.locator('canvas').click({ position: { x: 90, y: 90 } });
  await expect(map).toHaveAttribute('data-route-points', '0');
  await expect(map).toHaveAttribute('data-route-state', 'idle');
});

test('unknown, zero and outside-ZA provider locations never become map pins', async ({ page }) => {
  let injectedResponses = 0;
  await page.route(/\/data\/(?:photographers|models)(?:\?|$)/, async (route) => {
    if (route.request().postDataJSON()?.action !== 'select') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (!Array.isArray(body.data)) return route.fulfill({ response });
    const invalid = [
      {}, { latitude: null, longitude: null }, { latitude: 0, longitude: 0 },
      { latitude: 51.5074, longitude: -0.1278 }, { latitude: 999, longitude: 31.03 },
      { latitude: -29.85, longitude: 0 }, { latitude: '-29.85', longitude: '31.03' },
    ].map((coordinates, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, ...coordinates }));
    injectedResponses++;
    await route.fulfill({ response, json: { ...body, data: [...invalid, ...body.data] } });
  });
  const map = await openOracleMap(page);
  await expect(map).toHaveAttribute('data-map-state', 'ready', { timeout: 40000 });
  await selectTalent(map);
  expect(injectedResponses).toBeGreaterThan(0);
  await expect(map.locator('[data-marker-id*="00000000-0000-4000-8000"]')).toHaveCount(0);
});

test('road geometry outside ZA or snapped far from the destination is rejected', async ({ page }) => {
  let requests = 0;
  await page.route(ROUTING_ENDPOINT, (route) => {
    requests++;
    const params = new URL(route.request().url()).searchParams;
    const destination = [Number(params.get('end_lng')), Number(params.get('end_lat')) + 0.02];
    const coordinates = [[31.04, -29.87], requests === 1 ? [0, 0] : destination];
    return route.fulfill({ json: { source: 'osrm', coordinates, distance: 1736, duration: 102120 } });
  });
  const map = await openOracleMap(page);
  await expect(map).toHaveAttribute('data-map-state', 'ready', { timeout: 40000 });
  await map.getByRole('button', { name: 'Find my location', exact: true }).click();
  await expect(map.locator('button[data-marker-type="user"]')).toBeAttached({ timeout: 15000 });
  for (let attempt = 0; attempt < 2; attempt++) {
    await selectTalent(map);
    await expect(map).toHaveAttribute('data-route-state', 'unavailable');
    await expect(map).toHaveAttribute('data-route-points', '0');
    await expect(map.getByRole('status')).toContainText('Road routing unavailable.');
    await map.locator('canvas').click({ position: { x: 90, y: 90 } });
    await expect(map).toHaveAttribute('data-route-state', 'idle');
  }
  expect(requests).toBe(2);
});

test('Oracle routing failure shows no invented line or ETA', async ({ page }) => {
  let failedRoutes = 0;
  await page.route(ROUTING_ENDPOINT, (route) => { failedRoutes++; return route.abort(); });
  const map = await openOracleMap(page);
  await expect(map).toHaveAttribute('data-map-state', 'ready', { timeout: 40000 });
  await map.getByRole('button', { name: 'Find my location', exact: true }).click();
  await expect(map.locator('button[data-marker-type="user"]')).toBeAttached({ timeout: 15000 });
  await selectTalent(map);
  await expect(map).toHaveAttribute('data-route-state', 'unavailable', { timeout: 15000 });
  expect(failedRoutes).toBeGreaterThan(0);
  await expect(map).toHaveAttribute('data-route-points', '0');
  await expect(map.getByRole('status')).toContainText('Road routing unavailable. Navigation and ETA are unavailable.');
  await expect(map.getByRole('status')).not.toContainText(/ETA \d+|\d+ min/);
});

test('map tile failure is visible and retry replaces the failed map', async ({ page }) => {
  await page.route(OPEN_FREE_MAP, (route) => route.abort());
  const map = await openOracleMap(page);
  await expect(map.getByRole('alert')).toContainText('Map tiles could not be loaded.', { timeout: 20000 });
  await page.unroute(OPEN_FREE_MAP);
  await map.getByRole('button', { name: 'Retry map' }).click();
  await expect(map).toHaveAttribute('data-map-state', 'ready', { timeout: 40000 });
  await expect(map.getByRole('alert')).toHaveCount(0);
  await expect(map.locator('canvas.maplibregl-canvas')).toHaveCount(1);
  await expect(map.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCount(1);
});

test('unsupported WebGL is reported honestly without an uncaught crash', async ({ page }) => {
  const crashes = [];
  page.on('pageerror', (error) => crashes.push(error.message));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...options) {
      return type.startsWith('webgl') || type === 'experimental-webgl' ? null : getContext.call(this, type, ...options);
    };
  });
  const map = await openOracleMap(page);
  await expect(map).toHaveAttribute('data-map-state', 'error');
  await expect(map.getByRole('alert')).toContainText('Interactive map unavailable.');
  await expect(map.getByRole('button', { name: 'Retry map' })).toBeVisible();
  expect(crashes).toEqual([]);
});
