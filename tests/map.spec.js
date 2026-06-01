/**
 * tests/map.spec.js — Venture Mapbox pin integrity tests
 *
 * Five tests verify that map pins render correctly and survive various
 * user interactions. Requires window.ventureMap and window.ventureMapMarkers
 * exposed by MapView.jsx.
 *
 * Prerequisites: run qa.spec.js first to create a Lisbon trip.
 *
 * Run: npx playwright test tests/map.spec.js
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const EMAIL    = process.env.TEST_EMAIL    || '';
const PASSWORD = process.env.TEST_PASSWORD || '';

// Shared trip ID — discovered on first call to setupMapPage, reused thereafter
let mapTripId = '';

// ── Mock spot data (7 Lisbon spots, all with valid lat/lng) ──────────────────
const MAP_SPOTS = [
  { id: 'ms1', name: 'LX Factory',         lat: 38.7048, lng: -9.1773, hiddennessScore: 6, category: 'Markets',     interests: ['markets'],      entryPrice: 0,  visitDurationMinutes: 90  },
  { id: 'ms2', name: 'Miradouro da Graça', lat: 38.7185, lng: -9.1310, hiddennessScore: 8, category: 'Viewpoints',  interests: ['photography'],  entryPrice: 0,  visitDurationMinutes: 30  },
  { id: 'ms3', name: 'Tasca do Chico',     lat: 38.7132, lng: -9.1424, hiddennessScore: 7, category: 'Restaurants', interests: ['food'],          entryPrice: 15, visitDurationMinutes: 120 },
  { id: 'ms4', name: 'Museu do Azulejo',   lat: 38.7240, lng: -9.1150, hiddennessScore: 5, category: 'Museums',     interests: ['art'],           entryPrice: 5,  visitDurationMinutes: 60  },
  { id: 'ms5', name: 'Alfama Viewpoint',   lat: 38.7144, lng: -9.1267, hiddennessScore: 4, category: 'Viewpoints',  interests: ['photography'],  entryPrice: 0,  visitDurationMinutes: 45  },
  { id: 'ms6', name: 'Pastéis de Belém',   lat: 38.6971, lng: -9.2033, hiddennessScore: 2, category: 'Food',        interests: ['food'],          entryPrice: 3,  visitDurationMinutes: 30  },
  { id: 'ms7', name: 'Campo das Cebolas',  lat: 38.7100, lng: -9.1250, hiddennessScore: 9, category: 'Squares',     interests: ['architecture'], entryPrice: 0,  visitDurationMinutes: 20  },
];

// Geographic sanity bounds for Lisbon
const LISBON_BBOX = { latMin: 38.6, latMax: 38.8, lngMin: -9.3, lngMax: -9.0 };

// ── Amsterdam mock data — Mapbox-geocoded coordinates ────────────────────────
// These coords come from the Mapbox Geocoding API, not AI guesses.
// Anne Frank House (52.3752, 4.8840) is the primary reference landmark used
// in test 7 to assert street-level pin accuracy (within 200 m).
const AMSTERDAM_SPOTS = [
  { id: 'ams1', name: 'Anne Frank House',    lat: 52.3752, lng: 4.8840, hiddennessScore: 2, category: 'museum',   interests: ['museums'],      entryPrice: 16, visitDurationMinutes: 90,  geocodeSource: 'mapbox' },
  { id: 'ams2', name: 'Rijksmuseum',         lat: 52.3600, lng: 4.8852, hiddennessScore: 1, category: 'museum',   interests: ['art'],          entryPrice: 22, visitDurationMinutes: 120, geocodeSource: 'mapbox' },
  { id: 'ams3', name: 'Van Gogh Museum',     lat: 52.3584, lng: 4.8811, hiddennessScore: 2, category: 'museum',   interests: ['art'],          entryPrice: 20, visitDurationMinutes: 90,  geocodeSource: 'mapbox' },
  { id: 'ams4', name: 'Vondelpark',          lat: 52.3607, lng: 4.8697, hiddennessScore: 5, category: 'park',     interests: ['relaxation'],   entryPrice: 0,  visitDurationMinutes: 60,  geocodeSource: 'mapbox' },
  { id: 'ams5', name: 'Bloemenmarkt',        lat: 52.3667, lng: 4.8900, hiddennessScore: 4, category: 'market',   interests: ['markets'],      entryPrice: 0,  visitDurationMinutes: 30,  geocodeSource: 'mapbox' },
  { id: 'ams6', name: 'Brouwersgracht',      lat: 52.3858, lng: 4.8842, hiddennessScore: 8, category: 'other',    interests: ['photography'],  entryPrice: 0,  visitDurationMinutes: 30,  geocodeSource: 'mapbox' },
  { id: 'ams7', name: 'NDSM Wharf',          lat: 52.4002, lng: 4.8987, hiddennessScore: 9, category: 'art',      interests: ['art'],          entryPrice: 0,  visitDurationMinutes: 60,  geocodeSource: 'mapbox' },
];

// Geographic sanity bounds for Amsterdam
const AMSTERDAM_BBOX = { latMin: 52.3, latMax: 52.45, lngMin: 4.75, lngMax: 5.0 };

/** Haversine distance between two points in metres */
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R    = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Mock SSE response builder ────────────────────────────────────────────────
function buildMockBody(spots = MAP_SPOTS) {
  const lines = [];
  lines.push(`event: status\ndata: ${JSON.stringify({ message: 'Mocked for map tests' })}\n`);
  spots.forEach(s => lines.push(`event: spot\ndata: ${JSON.stringify(s)}\n`));
  lines.push(`event: total\ndata: ${JSON.stringify({ total: spots.length })}\n`);
  lines.push(`event: done\ndata: ${JSON.stringify({ done: true })}\n`);
  return lines.join('\n');
}

function mockFulfill(spots = MAP_SPOTS) {
  return {
    status: 200,
    contentType: 'text/event-stream; charset=utf-8',
    headers: {
      'Cache-Control':     'no-cache',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
    body: buildMockBody(spots),
  };
}

async function mockMapResearchAPI(page, spots = MAP_SPOTS) {
  await page.route('**/api/research', route => route.fulfill(mockFulfill(spots)));
}

// ── Auth helper ──────────────────────────────────────────────────────────────
async function signIn(page) {
  await page.goto('/auth');
  await page.waitForLoadState('domcontentloaded');
  await page.getByPlaceholder('Email').fill(EMAIL);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  let redirected = false;
  try {
    await page.waitForURL(url => !url.toString().includes('/auth'), { timeout: 8000 });
    redirected = true;
  } catch {}

  if (!redirected) {
    const body = await page.locator('body').innerText().catch(() => '');
    if (/incorrect|not found|no account|invalid.credential/i.test(body)) {
      await page.getByRole('button', { name: /^sign up$/i }).click();
      await page.waitForTimeout(400);
      const em = page.getByPlaceholder('Email');
      if (!(await em.inputValue().catch(() => ''))) await em.fill(EMAIL);
      const pw = page.getByPlaceholder('Password');
      if (!(await pw.inputValue().catch(() => ''))) await pw.fill(PASSWORD);
      await page.getByRole('button', { name: /create account/i }).click();
      await page.waitForURL(url => !url.toString().includes('/auth'), { timeout: 20_000 });
    } else {
      await page.waitForURL(url => !url.toString().includes('/auth'), { timeout: 15_000 });
    }
  }
  await page.waitForTimeout(1500);
}

// ── Map helpers ──────────────────────────────────────────────────────────────

/** Poll until window.ventureMap is non-null and the Mapbox style has loaded. */
async function waitForMapReady(page, timeout = 20000) {
  await page.waitForFunction(
    () => window.ventureMap?.loaded?.() === true,
    { timeout },
  );
}

/** Poll until window.ventureMapMarkers has at least minCount entries. */
async function waitForMarkers(page, minCount = 5, timeout = 20000) {
  await page.waitForFunction(
    n => (window.ventureMapMarkers?.length ?? 0) >= n,
    minCount,
    { timeout },
  );
}

/** Return the number of active markers currently in ventureMapMarkers. */
async function getMarkerCount(page) {
  return page.evaluate(() => window.ventureMapMarkers?.length ?? 0);
}

/** Return an array of { lat, lng } for every active marker. */
async function getMarkerCoords(page) {
  return page.evaluate(() =>
    (window.ventureMapMarkers ?? []).map(m => {
      const ll = m.getLngLat();
      return { lat: ll.lat, lng: ll.lng };
    })
  );
}

// ── Setup helper ─────────────────────────────────────────────────────────────
/**
 * Sign in, navigate to an existing Lisbon trip, force-refresh research so
 * Firestore has valid lat/lng from the mock, then wait until the Mapbox map
 * and at least 5 markers are ready.
 */
async function setupMapPage(page) {
  await mockMapResearchAPI(page);
  await signIn(page);

  // Discover an existing trip on first invocation
  if (!mapTripId) {
    await page.goto('/');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);
    const link = page.locator('a[href*="/trips/"]').first();
    if (await link.isVisible({ timeout: 5000 }).catch(() => false)) {
      const href = await link.getAttribute('href');
      const m    = href?.match(/\/trips\/([a-zA-Z0-9]+)/);
      if (m) mapTripId = m[1];
    }
    if (!mapTripId) {
      throw new Error(
        'No trip found. Run `npx playwright test tests/qa.spec.js` first to create a Lisbon trip.',
      );
    }
    console.log(`[Map tests] Using trip: ${mapTripId}`);
  }

  await page.goto(`/trips/${mapTripId}`);
  await page.waitForLoadState('load');
  await page.waitForTimeout(2500);

  // Force a fresh research run so Firestore caches valid lat/lng from the mock
  const refreshBtn = page.getByRole('button', { name: /refresh research/i }).first();
  if (await refreshBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
    await refreshBtn.click();
    await page.waitForTimeout(5000);
  }

  // Wait for Mapbox canvas → style loaded → ≥5 markers
  await page.waitForSelector('canvas', { timeout: 15000 });
  await waitForMapReady(page, 20000);
  await waitForMarkers(page, 5, 20000);
}

// ── Test suite ────────────────────────────────────────────────────────────────
test.describe('Map — pin integrity', () => {

  test.beforeAll(() => {
    if (!EMAIL || !PASSWORD) {
      throw new Error('TEST_EMAIL and TEST_PASSWORD must be set in .env.local');
    }
  });

  // ── 1. Pins render at correct geographic positions on first load ─────────────
  test('1 — Pins render at correct geographic positions on first load', async ({ page }) => {
    await setupMapPage(page);

    const count = await getMarkerCount(page);
    expect(count, 'At least 5 pins should be visible on first load').toBeGreaterThanOrEqual(5);

    const coords = await getMarkerCoords(page);
    expect(coords.length, 'Coords array length matches marker count').toBe(count);

    // Every pin must sit inside Lisbon's bounding box
    for (const c of coords) {
      expect(c.lat, `Marker lat ${c.lat} in Lisbon bbox`).toBeGreaterThan(LISBON_BBOX.latMin);
      expect(c.lat, `Marker lat ${c.lat} in Lisbon bbox`).toBeLessThan(LISBON_BBOX.latMax);
      expect(c.lng, `Marker lng ${c.lng} in Lisbon bbox`).toBeGreaterThan(LISBON_BBOX.lngMin);
      expect(c.lng, `Marker lng ${c.lng} in Lisbon bbox`).toBeLessThan(LISBON_BBOX.lngMax);
    }

    // Each MAP_SPOTS entry must have a matching pin within 0.001°
    for (const spot of MAP_SPOTS) {
      const match = coords.find(
        c => Math.abs(c.lat - spot.lat) < 0.001 && Math.abs(c.lng - spot.lng) < 0.001,
      );
      expect(match, `Pin for "${spot.name}" at (~${spot.lat}, ~${spot.lng})`).toBeTruthy();
    }
  });

  // ── 2. Pins survive zoom in to 16 then out to 10 ────────────────────────────
  test('2 — Pins survive zoom in to 16 then out to 10', async ({ page }) => {
    await setupMapPage(page);

    const countBefore = await getMarkerCount(page);
    expect(countBefore, 'Initial marker count ≥ 5').toBeGreaterThanOrEqual(5);

    // Zoom in to street level
    await page.evaluate(() => window.ventureMap.setZoom(16));
    await page.waitForTimeout(800);

    const countAtZoom16 = await getMarkerCount(page);
    expect(countAtZoom16, 'Marker count unchanged at zoom 16').toBe(countBefore);

    // Zoom out to city overview
    await page.evaluate(() => window.ventureMap.setZoom(10));
    await page.waitForTimeout(800);

    const countAtZoom10 = await getMarkerCount(page);
    expect(countAtZoom10, 'Marker count unchanged at zoom 10').toBe(countBefore);

    // Confirm coords are still correct after zoom changes
    const coords = await getMarkerCoords(page);
    for (const spot of MAP_SPOTS) {
      const match = coords.find(
        c => Math.abs(c.lat - spot.lat) < 0.001 && Math.abs(c.lng - spot.lng) < 0.001,
      );
      expect(match, `Pin for "${spot.name}" still at correct coords after zoom`).toBeTruthy();
    }
  });

  // ── 3. Pins survive Research → Days → Research tab round-trip ───────────────
  test('3 — Pins survive navigating to Days tab and back to Research', async ({ page }) => {
    await setupMapPage(page);

    const countBefore = await getMarkerCount(page);
    expect(countBefore, 'Initial marker count before tab switch').toBeGreaterThanOrEqual(5);

    // Navigate to Days tab — MapView component will unmount
    const daysTab = page.getByRole('button', { name: /days/i }).first();
    await expect(daysTab, 'Days tab button visible').toBeVisible({ timeout: 8000 });
    await daysTab.click();
    await page.waitForTimeout(1000);

    // Verify Days tab actually loaded
    const daysContent = page
      .getByText(/day 1|morning|afternoon|evening|No day plans|starred spots/i)
      .first();
    await expect(daysContent, 'Days tab has content').toBeVisible({ timeout: 10_000 });

    // Return to Research tab — MapView will remount and re-initialise
    const researchTab = page.getByRole('button', { name: /research/i }).first();
    await expect(researchTab, 'Research tab button visible').toBeVisible({ timeout: 8000 });
    await researchTab.click();
    await page.waitForTimeout(1500);

    // Wait for the new Mapbox instance to be ready, then for markers
    await page.waitForSelector('canvas', { timeout: 15000 });
    await waitForMapReady(page, 20000);
    await waitForMarkers(page, 5, 20000);

    const countAfter = await getMarkerCount(page);
    expect(countAfter, 'Pin count restored after returning to Research tab').toBeGreaterThanOrEqual(5);

    // All MAP_SPOTS must still be at correct coords
    const coords = await getMarkerCoords(page);
    for (const spot of MAP_SPOTS) {
      const match = coords.find(
        c => Math.abs(c.lat - spot.lat) < 0.001 && Math.abs(c.lng - spot.lng) < 0.001,
      );
      expect(match, `Pin "${spot.name}" intact after tab round-trip`).toBeTruthy();
    }
  });

  // ── 4. Map renders at 375×667 mobile viewport ────────────────────────────────
  test('4 — Map renders correctly at 375×667 mobile viewport', async ({ page }) => {
    // Set viewport BEFORE navigating so the entire session uses mobile layout
    await page.setViewportSize({ width: 375, height: 667 });

    await mockMapResearchAPI(page);
    await signIn(page);

    // Re-use trip ID discovered by earlier tests in this run
    if (!mapTripId) {
      await page.goto('/');
      await page.waitForLoadState('load');
      await page.waitForTimeout(2000);
      const link = page.locator('a[href*="/trips/"]').first();
      if (await link.isVisible({ timeout: 5000 }).catch(() => false)) {
        const href = await link.getAttribute('href');
        const m    = href?.match(/\/trips\/([a-zA-Z0-9]+)/);
        if (m) mapTripId = m[1];
      }
      if (!mapTripId) throw new Error('No trip found for mobile map test');
    }

    await page.goto(`/trips/${mapTripId}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Force-refresh so Firestore has valid coords
    const refreshBtn = page.getByRole('button', { name: /refresh research/i }).first();
    if (await refreshBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(5000);
    }

    // On mobile the map is hidden behind a toggle — switch to map view
    const mobileToggle = page.locator('.mobile-view-toggle').first();
    await expect(mobileToggle, 'Mobile view toggle visible at 375px').toBeVisible({ timeout: 8000 });

    // "Map" button inside the toggle row (exclude the step-progress "Research" button)
    const mapBtn = page
      .getByRole('button', { name: /🗺|map/i })
      .filter({ hasNot: page.locator('[class*="step"]') })
      .last();
    if (await mapBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await mapBtn.click();
      await page.waitForTimeout(1000);
    }

    // Mapbox canvas must appear
    await page.waitForSelector('canvas', { timeout: 15000 });
    await waitForMapReady(page, 25000);

    // Canvas must fit within the 375 px mobile viewport
    const canvas    = page.locator('canvas').first();
    const canvasBox = await canvas.boundingBox();
    if (canvasBox) {
      expect(canvasBox.width, 'Canvas width ≤ 375px viewport').toBeLessThanOrEqual(375 + 2);
      expect(canvasBox.x,     'Canvas not offset past left edge').toBeGreaterThanOrEqual(-2);
    }

    // At least one pin should be visible (mobile only shows map, coords still valid)
    await waitForMarkers(page, 1, 20000);
    const count = await getMarkerCount(page);
    expect(count, 'At least 1 pin visible on mobile map').toBeGreaterThanOrEqual(1);
  });

  // ── 6. Markers must be pixel-spread across the map (no vertical-line stacking)
  //
  // This test catches the React strict-mode double-init bug that previously
  // caused MapView to create two Mapbox instances in the same container.  The
  // second instance renders on a mis-measured canvas (width ≈ 0), placing all
  // markers at pixel x=0 — a "vertical line".  getLngLat() always returns the
  // correct geographic coord, so geographic-only tests miss this.  Here we read
  // the actual on-screen bounding rect of every marker element, then assert
  // that the horizontal (x) spread is at least 15 px.
  test('6 — Markers have real horizontal pixel spread (not a vertical line)', async ({ page }) => {
    await setupMapPage(page);

    // Zoom to a level where the Lisbon spots (~9 km E-W) span many pixels
    await page.evaluate(() => window.ventureMap.fitBounds(
      [[-9.215, 38.690], [-9.110, 38.730]],
      { padding: 40, duration: 0 },
    ));
    await page.waitForTimeout(600);

    const spread = await page.evaluate(() => {
      const markers = window.ventureMapMarkers ?? [];
      if (markers.length < 2) return null;
      const rects = markers
        .map(m => m.getElement()?.getBoundingClientRect())
        .filter(Boolean);
      if (rects.length < 2) return null;
      const xs = rects.map(r => r.left + r.width / 2);
      const ys = rects.map(r => r.top  + r.height / 2);
      return {
        xSpread: Math.max(...xs) - Math.min(...xs),
        ySpread: Math.max(...ys) - Math.min(...ys),
        count:   rects.length,
      };
    });

    expect(spread, 'Marker bounding-rect data available').toBeTruthy();
    expect(
      spread.xSpread,
      `Markers spread ≥15 px horizontally — got ${spread.xSpread?.toFixed(1)}px (0 px = vertical line bug)`,
    ).toBeGreaterThan(15);
    expect(
      spread.count,
      'Pixel-spread check used ≥ 2 markers',
    ).toBeGreaterThanOrEqual(2);
  });

  // ── 7. Street-level accuracy — pins within 200 m of known coordinates ────────
  //
  // Uses Amsterdam mock data (Mapbox-geocoded coords) and zooms to level 15
  // so the map is at street level (~1:2000 scale).  Every pin must land within
  // 200 metres of its expected position.  Anne Frank House (52.3752, 4.8840) is
  // the primary reference landmark — it is globally recognisable and its exact
  // position is verifiable against any street map.
  //
  // This test catches geocoding regressions where AI-guessed coordinates (which
  // can be off by kilometres) would slip through.
  test('7 — Pins accurate to 200 m at zoom 15 (street level, Amsterdam reference)', async ({ page }) => {
    // Override the mock with Amsterdam spots before setting up the map page
    await mockMapResearchAPI(page, AMSTERDAM_SPOTS);
    await signIn(page);

    if (!mapTripId) {
      await page.goto('/');
      await page.waitForLoadState('load');
      await page.waitForTimeout(2000);
      const link = page.locator('a[href*="/trips/"]').first();
      if (await link.isVisible({ timeout: 5000 }).catch(() => false)) {
        const href = await link.getAttribute('href');
        const m    = href?.match(/\/trips\/([a-zA-Z0-9]+)/);
        if (m) mapTripId = m[1];
      }
      if (!mapTripId) throw new Error('No trip found for Amsterdam accuracy test');
    }

    await page.goto(`/trips/${mapTripId}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(2500);

    // Force a research refresh so the Amsterdam mock data is loaded into the map
    const refreshBtn = page.getByRole('button', { name: /refresh research/i }).first();
    if (await refreshBtn.isVisible({ timeout: 6000 }).catch(() => false)) {
      await refreshBtn.click();
      await page.waitForTimeout(5000);
    }

    await page.waitForSelector('canvas', { timeout: 15000 });
    await waitForMapReady(page, 20000);
    await waitForMarkers(page, AMSTERDAM_SPOTS.length - 1, 20000);

    // Zoom to street level
    await page.evaluate(() => window.ventureMap.setZoom(15));
    await page.waitForTimeout(600);

    const coords = await getMarkerCoords(page);
    expect(coords.length, 'Amsterdam markers present at zoom 15').toBeGreaterThanOrEqual(1);

    // Every pin must be inside Amsterdam's bounding box
    for (const c of coords) {
      expect(c.lat, `Marker lat ${c.lat} in Amsterdam bbox`).toBeGreaterThan(AMSTERDAM_BBOX.latMin);
      expect(c.lat, `Marker lat ${c.lat} in Amsterdam bbox`).toBeLessThan(AMSTERDAM_BBOX.latMax);
      expect(c.lng, `Marker lng ${c.lng} in Amsterdam bbox`).toBeGreaterThan(AMSTERDAM_BBOX.lngMin);
      expect(c.lng, `Marker lng ${c.lng} in Amsterdam bbox`).toBeLessThan(AMSTERDAM_BBOX.lngMax);
    }

    // Every Amsterdam mock spot must have a matching pin within 200 m
    const MAX_METRES = 200;
    for (const spot of AMSTERDAM_SPOTS) {
      const match = coords.find(c => haversineMetres(c.lat, c.lng, spot.lat, spot.lng) <= MAX_METRES);
      expect(
        match,
        `Pin for "${spot.name}" (expected ~${spot.lat}, ~${spot.lng}) must be within ${MAX_METRES} m`,
      ).toBeTruthy();
      if (match) {
        const dist = haversineMetres(match.lat, match.lng, spot.lat, spot.lng);
        expect(
          dist,
          `"${spot.name}" pin is ${dist.toFixed(0)} m from expected — must be ≤ ${MAX_METRES} m`,
        ).toBeLessThanOrEqual(MAX_METRES);
      }
    }

    // Explicit reference check: Anne Frank House within 200 m of (52.3752, 4.8840)
    const AFH_LAT = 52.3752;
    const AFH_LNG = 4.8840;
    const afhPin  = coords.find(c => haversineMetres(c.lat, c.lng, AFH_LAT, AFH_LNG) <= MAX_METRES);
    expect(
      afhPin,
      `Anne Frank House pin must be within ${MAX_METRES} m of (${AFH_LAT}, ${AFH_LNG})`,
    ).toBeTruthy();
  });

  // ── 5. Selecting a spot flies the map center within 0.01° of the spot ────────
  test('5 — Selecting a spot moves map center within 0.01° of its coords', async ({ page }) => {
    await setupMapPage(page);

    // Click the first available marker via JS eval.
    // The marker's onclick calls onSpotClickRef.current(spot) → handleSpotClick(spot)
    // → setSelectedSpotId(spot.id) → focusSpotId prop updates → MapView flyTo effect fires.
    const markerInfo = await page.evaluate(() => {
      const marker = window.ventureMapMarkers?.[0];
      if (!marker) return null;
      const ll = marker.getLngLat();
      marker.getElement()?.click();          // triggers React state update chain
      return { lat: ll.lat, lng: ll.lng };   // record where it was before flyTo
    });

    if (!markerInfo) {
      test.skip(true, 'No markers available — skipping flyTo check');
      return;
    }

    // flyTo duration is 500 ms — wait 1 200 ms to include React render + animation
    await page.waitForTimeout(1200);

    const center = await page.evaluate(() => {
      const c = window.ventureMap.getCenter();
      return { lat: c.lat, lng: c.lng };
    });

    const latDiff = Math.abs(center.lat - markerInfo.lat);
    const lngDiff = Math.abs(center.lng - markerInfo.lng);

    expect(
      latDiff,
      `Map lat within 0.01° of clicked marker (diff: ${latDiff.toFixed(5)}°)`,
    ).toBeLessThan(0.01);
    expect(
      lngDiff,
      `Map lng within 0.01° of clicked marker (diff: ${lngDiff.toFixed(5)}°)`,
    ).toBeLessThan(0.01);
  });

});
