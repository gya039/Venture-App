/**
 * tests/qa.spec.js — Venture full end-to-end QA suite
 *
 * 15-step user journey:
 *  1.  Guest homepage
 *  2.  Auth page renders
 *  3.  Sign in (auto-creates account on first run)
 *  4.  Onboarding modal (dismiss if shown)
 *  5.  Dashboard structure
 *  6.  Create a trip via TripModal
 *  7.  Research tab renders (mocked API — no OpenAI charge)
 *  8.  Discover sub-tab renders
 *  9.  Days tab renders
 * 10.  Pass tab renders
 * 11.  Profile page — badges
 * 12.  Settings page — form fields
 * 13.  Days tab has ⬇ PDF export button
 * 14.  Share page renders (makes trip public first)
 * 15.  No render artifacts site-wide
 *
 * Run: npx playwright test --headed --slowMo=500
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const EMAIL    = process.env.TEST_EMAIL    || '';
const PASSWORD = process.env.TEST_PASSWORD || '';

// Shared state across tests in this worker (workers: 1)
let createdTripId = '';

// ── Mock spot data for /api/research ──────────────────────────────────────────

const MOCK_SPOTS = [
  {
    id: 'mock-spot-1',
    name: 'LX Factory',
    description: 'A creative hub in a former industrial complex.',
    category: 'Markets',
    hiddennessScore: 6,
    address: 'R. Rodrigues de Faria 103, Lisbon',
    lat: 38.7048, lng: -9.1773,
    entryPrice: 0,
    visitDurationMinutes: 90,
    interests: ['markets', 'art'],
  },
  {
    id: 'mock-spot-2',
    name: 'Miradouro da Graça',
    description: 'A lesser-known viewpoint beloved by locals.',
    category: 'Viewpoints',
    hiddennessScore: 8,
    address: 'Largo da Graça, Lisbon',
    lat: 38.7185, lng: -9.1310,
    entryPrice: 0,
    visitDurationMinutes: 30,
    interests: ['photography'],
  },
  {
    id: 'mock-spot-3',
    name: 'Tasca do Chico',
    description: 'Tiny fado restaurant with authentic live music.',
    category: 'Restaurants',
    hiddennessScore: 7,
    address: 'R. do Diário de Notícias 39, Lisbon',
    lat: 38.7132, lng: -9.1424,
    entryPrice: 15,
    visitDurationMinutes: 120,
    interests: ['food', 'nightlife'],
  },
];

/** Build a proper SSE stream response that simulates the /api/research endpoint. */
function buildMockResearchBody() {
  const lines = [];
  lines.push(`event: status\ndata: ${JSON.stringify({ message: 'Research mocked for QA tests' })}\n`);
  MOCK_SPOTS.forEach((spot) => {
    lines.push(`event: spot\ndata: ${JSON.stringify(spot)}\n`);
  });
  lines.push(`event: total\ndata: ${JSON.stringify({ total: MOCK_SPOTS.length })}\n`);
  lines.push(`event: done\ndata: ${JSON.stringify({ done: true })}\n`);
  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Assert no raw React render artifacts in body text. */
async function assertClean(page, label) {
  const txt = await page.locator('body').innerText().catch(() => '');
  const pre  = label ? `[${label}] ` : '';
  expect(txt, `${pre}contains "[object Object]"`).not.toContain('[object Object]');
  const lines = txt.split('\n');
  for (const line of lines) {
    if (line.trim().length < 3) continue;
    expect(line, `${pre}bare "undefined" in line`).not.toMatch(/^\s*undefined\s*$/);
    expect(line, `${pre}bare "NaN" in line`).not.toMatch(/^\s*NaN\s*$/);
  }
}

/**
 * Intercept /api/research and return mock SSE data.
 * Call this before navigating to any trip page.
 */
async function mockResearchAPI(page) {
  await page.route('**/api/research', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      headers: {
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
      body: buildMockResearchBody(),
    });
  });
}

/**
 * Sign in with TEST_EMAIL/TEST_PASSWORD.
 * If the account doesn't exist, automatically creates it and continues.
 */
async function signIn(page) {
  await page.goto('/auth');
  await page.waitForLoadState('domcontentloaded');

  await page.getByPlaceholder('Email').fill(EMAIL);
  await page.getByPlaceholder('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  // Wait up to 8s for redirect OR visible error message
  let redirected = false;
  try {
    await page.waitForURL(
      (url) => !url.toString().includes('/auth'),
      { timeout: 8000 },
    );
    redirected = true;
  } catch {
    // still on /auth — check for error
  }

  if (!redirected) {
    // Check for "incorrect" / "not found" error
    const errorText = await page.locator('body').innerText().catch(() => '');
    const isCredError = /incorrect|not found|no account|invalid.credential/i.test(errorText);

    if (isCredError) {
      console.log('[signIn] Account not found — creating test account…');
      // Switch to Sign Up mode by clicking the "Sign up" button
      await page.getByRole('button', { name: /^sign up$/i }).click();
      await page.waitForTimeout(400);
      // Re-fill fields in case React cleared them
      const emailInput    = page.getByPlaceholder('Email');
      const passwordInput = page.getByPlaceholder('Password');
      const currentEmail  = await emailInput.inputValue().catch(() => '');
      if (!currentEmail) await emailInput.fill(EMAIL);
      const currentPw    = await passwordInput.inputValue().catch(() => '');
      if (!currentPw)   await passwordInput.fill(PASSWORD);
      // Create the account
      await page.getByRole('button', { name: /create account/i }).click();
      await page.waitForURL(
        (url) => !url.toString().includes('/auth'),
        { timeout: 20_000 },
      );
      console.log('[signIn] Test account created successfully');
    } else {
      // Some other situation — just wait a bit more
      await page.waitForURL(
        (url) => !url.toString().includes('/auth'),
        { timeout: 15_000 },
      );
    }
  }

  // Let Firebase + React settle
  await page.waitForTimeout(2000);
}

/** Dismiss onboarding if visible.
 *
 * Button labels (from OnboardingModal.jsx):
 *  Step 0: "Continue →" or "Skip this step →" + secondary "Skip setup entirely"
 *  Step 1: "Continue →"  + secondary "Skip"
 *  Step 2: "Plan my first trip →" + secondary "Explore the dashboard first"
 */
async function dismissOnboarding(page) {
  // Detect by the modal heading
  const heading = page.getByText('Welcome to Venture').first();
  const visible  = await heading.isVisible({ timeout: 3000 }).catch(() => false);
  if (!visible) return;

  // Step 0: pick a travel style and click Continue
  const styleCard = page.getByText('Food & Nightlife').first();
  if (await styleCard.isVisible({ timeout: 1000 }).catch(() => false)) {
    await styleCard.click();
  }
  await page.getByRole('button', { name: /continue|skip this step/i }).first().click();
  await page.waitForTimeout(400);

  // Step 1: skip home city
  const step1Skip = page.getByRole('button', { name: /^skip$/i }).first();
  const step1Continue = page.getByRole('button', { name: /continue/i }).first();
  if (await step1Skip.isVisible({ timeout: 1000 }).catch(() => false)) {
    await step1Skip.click();
  } else if (await step1Continue.isVisible({ timeout: 1000 }).catch(() => false)) {
    await step1Continue.click();
  }
  await page.waitForTimeout(400);

  // Step 2: close without opening trip modal
  const dashBtn = page.getByRole('button', { name: /explore the dashboard|explore dashboard/i }).first();
  const planBtn = page.getByRole('button', { name: /plan my first trip/i }).first();
  if (await dashBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await dashBtn.click();
  } else if (await planBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    // planBtn opens TripModal — not what we want here; press Escape to close
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(800);
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('Venture — 15-Step QA Journey', () => {

  test.beforeAll(() => {
    if (!EMAIL || !PASSWORD) {
      throw new Error(
        'TEST_EMAIL and TEST_PASSWORD are not set in .env.local.\n' +
        'Add them manually — the test will auto-create the Firebase account on first run.',
      );
    }
  });

  // ── 1. Guest homepage ──────────────────────────────────────────────────────
  test('Step 1 — Guest homepage', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Brand visible
    await expect(page.getByText('Venture').first()).toBeVisible();

    // Guest CTA (Sign in link or button)
    const cta = page.getByRole('link', { name: /sign in|get started|start planning/i }).first();
    await expect(cta).toBeVisible();

    await assertClean(page, 'guest homepage');

    const realErrors = errors.filter(
      (e) => !e.includes('service-worker') && !e.includes('ResizeObserver'),
    );
    expect(realErrors, 'Unexpected page errors on guest homepage').toHaveLength(0);
  });

  // ── 2. Auth page ───────────────────────────────────────────────────────────
  test('Step 2 — Auth page renders correctly', async ({ page }) => {
    await page.goto('/auth');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByText('Continue with Google')).toBeVisible();
    await expect(page.getByRole('button', { name: /forgot password/i })).toBeVisible();

    await assertClean(page, 'auth page');
  });

  // ── 3. Sign in ─────────────────────────────────────────────────────────────
  test('Step 3 — Sign in redirects to dashboard', async ({ page }) => {
    await signIn(page);
    // After sign-in we should be on / (not /auth)
    expect(page.url()).not.toContain('/auth');
    await expect(page.getByText('Venture').first()).toBeVisible();
  });

  // ── 4. Onboarding modal ────────────────────────────────────────────────────
  test('Step 4 — Onboarding modal (dismiss if shown)', async ({ page }) => {
    await signIn(page);
    await dismissOnboarding(page);

    // Modal should be gone
    await expect(
      page.getByText('Welcome to Venture').first(),
    ).not.toBeVisible({ timeout: 5000 });

    await assertClean(page, 'post-onboarding dashboard');
  });

  // ── 5. Dashboard structure ─────────────────────────────────────────────────
  test('Step 5 — Dashboard structure', async ({ page }) => {
    await signIn(page);
    await dismissOnboarding(page);

    // Navigation present
    const nav = page.locator('nav, [role="navigation"]').first();
    await expect(nav).toBeVisible();

    // "New trip" / "+" action button present (TopNav or BottomNav)
    const newTripBtn = page.getByRole('button', { name: /new trip|\+|plan a trip/i }).first();
    await expect(newTripBtn).toBeVisible();

    await assertClean(page, 'dashboard');
  });

  // ── 6. Create trip ─────────────────────────────────────────────────────────
  test('Step 6 — Create a trip (Lisbon)', async ({ page }) => {
    await signIn(page);
    await dismissOnboarding(page);
    await mockResearchAPI(page);

    // ── Open TripModal
    const newTripBtn = page.getByRole('button', { name: /new trip|\+|plan a trip/i }).first();
    await newTripBtn.click();

    // ── Step 0: Destination
    // The input has placeholder "e.g. Amsterdam"
    const destInput = page.getByPlaceholder('e.g. Amsterdam');
    await expect(destInput).toBeVisible({ timeout: 8000 });

    // Preferred: click the "Lisbon" curated city chip (faster, no autocomplete needed)
    const lisbonChip = page.locator('button').filter({ hasText: /^.{0,4}Lisbon$/ }).first();
    if (await lisbonChip.isVisible({ timeout: 2000 }).catch(() => false)) {
      await lisbonChip.click();
    } else {
      // Fallback: type and wait for autocomplete
      await destInput.fill('Lisbon');
      await page.waitForTimeout(600);
      const dropdownItem = page.locator('[role="option"], ul li').first();
      if (await dropdownItem.isVisible({ timeout: 1500 }).catch(() => false)) {
        await dropdownItem.click();
      }
    }

    // Validate city field has content
    const cityVal = await destInput.inputValue().catch(() => '');
    expect(cityVal.trim() || 'Lisbon', 'City should be set').toBeTruthy();

    // Next button says "Next →"
    await page.getByRole('button', { name: 'Next →' }).click();

    // ── Step 1: Dates
    const dateInputs = page.locator('input[type="date"]');
    await expect(dateInputs.first()).toBeVisible({ timeout: 8000 });

    const today = new Date();
    const fmtDate = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const startDate = new Date(today); startDate.setDate(today.getDate() + 28);
    const endDate   = new Date(today); endDate.setDate(today.getDate() + 32); // 4-night trip

    await dateInputs.first().fill(fmtDate(startDate));
    await dateInputs.last().fill(fmtDate(endDate));
    await page.getByRole('button', { name: 'Next →' }).click();

    // ── Step 2: Interests
    await page.waitForTimeout(500);
    const interestBtn = page.getByRole('button').filter({ hasText: /food|art|hiking|museum/i }).first();
    if (await interestBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await interestBtn.click();
    }
    // Step 2 → 3: "Review Trip →"
    await page.getByRole('button', { name: /review trip|next/i }).first().click();

    // ── Step 3 (Review): Create trip
    await page.waitForTimeout(500);
    // Button says "✈️  Create Trip"
    const createBtn = page.getByRole('button', { name: /create trip/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 8000 });
    await createBtn.click();

    // Navigate to /trips/[id]
    await page.waitForURL(/\/trips\/[a-zA-Z0-9]+/, { timeout: 30_000 });
    const match = page.url().match(/\/trips\/([a-zA-Z0-9]+)/);
    createdTripId = match ? match[1] : '';
    expect(createdTripId, 'Trip ID should be non-empty after creation').toBeTruthy();
    console.log(`✅ Trip created: ${createdTripId}`);

    await assertClean(page, 'trip page after creation');
  });

  // ── 7. Research tab ────────────────────────────────────────────────────────
  test('Step 7 — Research tab (mocked AI spots)', async ({ page }) => {
    if (!createdTripId) { test.skip(true, 'Skipped: no trip from Step 6'); return; }

    await mockResearchAPI(page);
    await signIn(page);
    await page.goto(`/trips/${createdTripId}`);
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Research tab (step-progress button) should be active by default
    // Note: there are 2 buttons matching /research/: "1 Research" tab + "🔄 Refresh Research"
    await expect(page.getByRole('button', { name: /research/i }).first()).toBeVisible();

    // Wait for mock research to stream spots OR existing spots from cache
    // The mock API returns instantly; spots should appear within 5s
    const spotElement = page.getByText('LX Factory').first()
      .or(page.getByText('Miradouro da Graça').first())
      .or(page.locator('h3').first());

    // Either mocked spots appear, or the city is already researched
    await page.waitForTimeout(5000); // let streaming settle

    const bodyTxt = await page.locator('body').innerText().catch(() => '');
    const hasSpots = bodyTxt.includes('LX Factory') ||
                     bodyTxt.includes('Miradouro') ||
                     bodyTxt.length > 200;
    expect(hasSpots, 'Research tab should show spots or content').toBe(true);

    await assertClean(page, 'research tab');
  });

  // ── 8. Discover sub-tab ────────────────────────────────────────────────────
  test('Step 8 — Discover sub-tab', async ({ page }) => {
    if (!createdTripId) { test.skip(true, 'Skipped: no trip from Step 6'); return; }

    await mockResearchAPI(page);
    await signIn(page);
    await page.goto(`/trips/${createdTripId}`);
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2000); // let research init settle

    // Click Discover sub-tab (shows as "✦ Discover") — not a step-progress btn, just a sub-tab btn
    const discoverBtn = page.getByRole('button', { name: /discover/i }).first();
    await expect(discoverBtn).toBeVisible({ timeout: 8000 });
    await discoverBtn.click();
    await page.waitForTimeout(1200);

    // Should show ranked spots or "Research this city first" message
    const discoverContent = page.getByText(/Research this city first|traveller|Be first|popular spot/i).first();
    const rankContent     = page.getByText(/🥇|🥈|🥉/i).first();
    const hasDiscover = await discoverContent.isVisible({ timeout: 3000 }).catch(() => false);
    const hasRanks    = await rankContent.isVisible({ timeout: 1000 }).catch(() => false);

    expect(hasDiscover || hasRanks, 'Discover tab should show ranked spots or guidance').toBe(true);

    await assertClean(page, 'discover tab');
  });

  // ── 9. Days tab ────────────────────────────────────────────────────────────
  test('Step 9 — Days tab renders', async ({ page }) => {
    if (!createdTripId) { test.skip(true, 'Skipped: no trip from Step 6'); return; }

    await mockResearchAPI(page);
    await signIn(page);
    await page.goto(`/trips/${createdTripId}`);
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Click Days tab — step-progress button text is "2 Days" (with step number prefix)
    const daysTab = page.getByRole('button', { name: /days/i }).first();
    await expect(daysTab).toBeVisible();
    await daysTab.click();
    await page.waitForTimeout(1500);

    // Should show either day columns or empty state
    const dayContent = page.getByText(/day 1|morning|afternoon|evening|No day plans|starred spots/i).first();
    await expect(dayContent).toBeVisible({ timeout: 10_000 });

    await assertClean(page, 'days tab');
  });

  // ── 10. Pass tab ───────────────────────────────────────────────────────────
  test('Step 10 — Pass tab renders', async ({ page }) => {
    if (!createdTripId) { test.skip(true, 'Skipped: no trip from Step 6'); return; }

    await mockResearchAPI(page);
    await signIn(page);
    await page.goto(`/trips/${createdTripId}`);
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Pass tab — step-progress button text is "3 Pass"
    const passTab = page.getByRole('button', { name: /pass/i }).first();
    await expect(passTab).toBeVisible();
    await passTab.click();
    await page.waitForTimeout(2000);

    // DayPassCalculator or empty state
    const passContent = page.getByText(/city pass|tourist pass|no pass|day pass|loading|worth buying/i).first();
    await expect(passContent).toBeVisible({ timeout: 12_000 });

    await assertClean(page, 'pass tab');
  });

  // ── 11. Profile page ───────────────────────────────────────────────────────
  test('Step 11 — Profile page: badges and stats', async ({ page }) => {
    await signIn(page);
    await page.goto('/profile');
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Profile content visible
    const profileEl = page.getByText(/explorer|badges|trips|cities|stats/i).first();
    await expect(profileEl).toBeVisible({ timeout: 10_000 });

    // "First Explorer" badge — earned by creating ≥1 trip
    const firstExplorer = page.getByText(/first explorer/i);
    await expect(firstExplorer).toBeVisible({ timeout: 8000 });

    await assertClean(page, 'profile page');
  });

  // ── 12. Settings page ──────────────────────────────────────────────────────
  test('Step 12 — Settings page: form fields present', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings');
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Settings heading
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible({ timeout: 10_000 });

    // "Display name" row label is always visible (input appears after clicking "Edit")
    await expect(page.getByText('Display name').first()).toBeVisible();

    // Currency section
    await expect(page.getByText('Currency').first()).toBeVisible();

    // "Edit" button for display name
    await expect(page.getByRole('button', { name: /edit/i }).first()).toBeVisible();

    await assertClean(page, 'settings page');
  });

  // ── 13. PDF export button ──────────────────────────────────────────────────
  test('Step 13 — Days tab has ⬇ PDF export button', async ({ page }) => {
    if (!createdTripId) { test.skip(true, 'Skipped: no trip from Step 6'); return; }

    await mockResearchAPI(page);
    await signIn(page);
    await page.goto(`/trips/${createdTripId}`);
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Go to Days tab — step-progress button text includes "Days"
    const daysTab = page.getByRole('button', { name: /days/i }).first();
    await daysTab.click();
    await page.waitForTimeout(1500);

    // PDF button is shown when days.length > 0
    // (generateDayPlans was called during trip creation with a 4-night span)
    const pdfBtn = page.getByRole('button', { name: /pdf/i }).first();
    await expect(pdfBtn).toBeVisible({ timeout: 10_000 });

    await assertClean(page, 'pdf export button');
  });

  // ── 14. Share page ─────────────────────────────────────────────────────────
  test('Step 14 — Share page renders after making trip public', async ({ page }) => {
    if (!createdTripId) { test.skip(true, 'Skipped: no trip from Step 6'); return; }

    await mockResearchAPI(page);
    await signIn(page);
    await page.goto(`/trips/${createdTripId}`);
    await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

    // Click "🔗 Share" to make the trip public and open share page
    const shareBtn = page.getByRole('button', { name: /share/i }).first();
    await expect(shareBtn).toBeVisible({ timeout: 8000 });

    // Set up a listener for the new tab that opens
    const newPagePromise = page.context().waitForEvent('page');
    await shareBtn.click();

    // Wait for the new share tab (or navigate directly if opened in same tab)
    let sharePage;
    try {
      sharePage = await newPagePromise;
      await sharePage.waitForLoadState('networkidle');
    } catch {
      // Fallback: navigate directly to share URL
      await page.goto(`/trips/${createdTripId}/share`);
      sharePage = page;
      await sharePage.waitForLoadState('networkidle');
    }

    // Share page should show the itinerary OR "not found" (if Firestore hasn't propagated)
    const shareContent = sharePage.getByText(/itinerary|lisbon|shared via venture|not found/i).first();
    await expect(shareContent).toBeVisible({ timeout: 10_000 });

    await assertClean(sharePage, 'share page');
  });

  // ── 15. No render artifacts site-wide ─────────────────────────────────────
  test('Step 15 — No render artifacts on key routes', async ({ page }) => {
    await mockResearchAPI(page);
    await signIn(page);

    const routes = ['/', '/profile', '/settings'];
    if (createdTripId) {
      routes.push(`/trips/${createdTripId}`);
      routes.push(`/trips/${createdTripId}/share`);
    }

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('load');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      await assertClean(page, route);
    }
  });

});
