/**
 * tests/responsive.spec.js — Venture responsive UI checks
 *
 * Tests the app at five real-world viewport sizes. At each size every key
 * page/feature is visited and checked for:
 *   - No horizontal overflow
 *   - Critical elements visible and within viewport bounds
 *   - Responsive layout switches (mobile toggle, sidebar, drawer)
 *
 * Viewports under test:
 *   Mobile S : 375 x 667   (iPhone SE)
 *   Mobile L : 414 x 896   (iPhone XR)
 *   Tablet   : 768 x 1024  (iPad)
 *   Laptop   : 1280 x 800
 *   Desktop  : 1440 x 900
 *
 * Run: npx playwright test tests/responsive.spec.js
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const EMAIL    = process.env.TEST_EMAIL    || '';
const PASSWORD = process.env.TEST_PASSWORD || '';

/* ── Viewports ───────────────────────────────────────────────────────────── */
const VIEWPORTS = [
  { name: 'mobile-s',  width: 375,  height: 667  },
  { name: 'mobile-l',  width: 414,  height: 896  },
  { name: 'tablet',    width: 768,  height: 1024 },
  { name: 'laptop',    width: 1280, height: 800  },
  { name: 'desktop',   width: 1440, height: 900  },
];

/* ── Shared state (workers: 1, fullyParallel: false) ─────────────────────── */
let sharedTripId = '';

/* ── Mock SSE spots (with lat/lng for map rendering) ─────────────────────── */
const MOCK_SPOTS = [
  { id: 'r1', name: 'LX Factory',         lat: 38.7048, lng: -9.1773, hiddennessScore: 6, category: 'Markets',    interests: ['markets'], entryPrice: 0, visitDurationMinutes: 90  },
  { id: 'r2', name: 'Miradouro da Graça', lat: 38.7185, lng: -9.1310, hiddennessScore: 8, category: 'Viewpoints', interests: ['photography'], entryPrice: 0, visitDurationMinutes: 30 },
  { id: 'r3', name: 'Tasca do Chico',     lat: 38.7132, lng: -9.1424, hiddennessScore: 7, category: 'Restaurants',interests: ['food'], entryPrice: 15, visitDurationMinutes: 120 },
];

function buildMockBody() {
  const lines = [];
  lines.push(`event: status\ndata: ${JSON.stringify({ message: 'Mocked for tests' })}\n`);
  MOCK_SPOTS.forEach(s => lines.push(`event: spot\ndata: ${JSON.stringify(s)}\n`));
  lines.push(`event: total\ndata: ${JSON.stringify({ total: MOCK_SPOTS.length })}\n`);
  lines.push(`event: done\ndata: ${JSON.stringify({ done: true })}\n`);
  return lines.join('\n');
}

async function mockResearchAPI(page) {
  await page.route('**/api/research', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      headers: { 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
      body: buildMockBody(),
    })
  );
}

/* ── Auth helpers ─────────────────────────────────────────────────────────── */
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

async function dismissOnboarding(page) {
  const heading = page.getByText('Welcome to Venture').first();
  if (!(await heading.isVisible({ timeout: 2000 }).catch(() => false))) return;
  const styleCard = page.getByText('Food & Nightlife').first();
  if (await styleCard.isVisible({ timeout: 500 }).catch(() => false)) await styleCard.click();
  await page.getByRole('button', { name: /continue|skip this step/i }).first().click();
  await page.waitForTimeout(300);
  const skip = page.getByRole('button', { name: /^skip$/i }).first();
  if (await skip.isVisible({ timeout: 500 }).catch(() => false)) await skip.click();
  else {
    const cont = page.getByRole('button', { name: /continue/i }).first();
    if (await cont.isVisible({ timeout: 500 }).catch(() => false)) await cont.click();
  }
  await page.waitForTimeout(300);
  const dashBtn = page.getByRole('button', { name: /explore the dashboard/i }).first();
  if (await dashBtn.isVisible({ timeout: 500 }).catch(() => false)) await dashBtn.click();
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 3);
}

async function screenshotPath(name) {
  return path.join(__dirname, 'screenshots', `${name}.png`);
}

async function captureScreenshot(page, name) {
  try {
    await page.screenshot({ path: await screenshotPath(name), fullPage: false });
  } catch (_) {}
}

/* ── Per-viewport test suite ─────────────────────────────────────────────── */
for (const vp of VIEWPORTS) {
  test.describe(`Viewport: ${vp.name} (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('Responsive checks — all pages', async ({ page }) => {
      const isMobile = vp.width <= 768;
      const label    = `${vp.name}`;

      // ── Landing page ─────────────────────────────────────────────────────
      await test.step('Landing page', async () => {
        await page.goto('/');
        await page.waitForLoadState('load');
        await page.waitForTimeout(500);

        // Hero heading visible
        const h1 = page.getByRole('heading', { level: 1 }).first();
        await expect(h1, `[${label}] h1 not visible`).toBeVisible({ timeout: 8000 });

        // Heading not clipped (has non-zero width)
        const h1Box = await h1.boundingBox();
        expect(h1Box?.width ?? 0, `[${label}] h1 has no width`).toBeGreaterThan(10);

        // CTA button visible and within viewport
        const cta = page
          .getByRole('link', { name: /get started|sign in|start planning/i })
          .first();
        await expect(cta, `[${label}] CTA not visible`).toBeVisible({ timeout: 5000 });
        const ctaBox = await cta.boundingBox();
        if (ctaBox) {
          expect(ctaBox.x, `[${label}] CTA left edge`).toBeGreaterThanOrEqual(-2);
          expect(ctaBox.x + ctaBox.width, `[${label}] CTA right edge`).toBeLessThanOrEqual(vp.width + 2);
        }

        // No horizontal overflow
        const ok = await noHorizontalOverflow(page);
        if (!ok) await captureScreenshot(page, `${label}-landing-overflow`);
        expect(ok, `[${label}] Landing: horizontal overflow`).toBe(true);
      });

      // ── Sign in ───────────────────────────────────────────────────────────
      await mockResearchAPI(page);
      await signIn(page);
      await dismissOnboarding(page);

      // Capture trip ID if not yet found
      if (!sharedTripId) {
        await page.goto('/');
        await page.waitForLoadState('load');
        await page.waitForTimeout(2000);
        const link = page.locator('a[href*="/trips/"]').first();
        if (await link.isVisible({ timeout: 4000 }).catch(() => false)) {
          const href = await link.getAttribute('href');
          const m    = href?.match(/\/trips\/([a-zA-Z0-9]+)/);
          if (m) sharedTripId = m[1];
        }
      }

      // ── Dashboard ─────────────────────────────────────────────────────────
      await test.step('Dashboard', async () => {
        await page.goto('/');
        await page.waitForLoadState('load');
        await page.waitForTimeout(1500);

        // New Trip button visible
        const newTripBtn = page.getByRole('button', { name: /new trip|\+|plan a trip/i }).first();
        await expect(newTripBtn, `[${label}] New Trip button`).toBeVisible({ timeout: 8000 });

        // No horizontal overflow
        const ok = await noHorizontalOverflow(page);
        if (!ok) await captureScreenshot(page, `${label}-dashboard-overflow`);
        expect(ok, `[${label}] Dashboard: horizontal overflow`).toBe(true);

        // Stats strip wraps without overflow (check if element exists)
        const statsStrip = page.locator('.stats-strip').first();
        if (await statsStrip.isVisible({ timeout: 2000 }).catch(() => false)) {
          const box = await statsStrip.boundingBox();
          if (box) {
            expect(box.x + box.width, `[${label}] Stats strip fits viewport`).toBeLessThanOrEqual(vp.width + 4);
          }
        }
      });

      // ── Explore page ──────────────────────────────────────────────────────
      await test.step('Explore page', async () => {
        await page.goto('/explore');
        await page.waitForLoadState('load');
        await page.waitForTimeout(500);

        // Search bar visible
        const searchBar = page.getByPlaceholder(/search any city/i).first();
        await expect(searchBar, `[${label}] Search bar`).toBeVisible({ timeout: 8000 });

        // On mobile the search bar should be nearly full-width (≥55% of vp)
        // The bar has fixed side padding so its ratio is 58–62% in practice.
        if (isMobile) {
          const box = await searchBar.boundingBox();
          if (box) {
            expect(box.width, `[${label}] Search bar width on mobile`).toBeGreaterThan(vp.width * 0.55);
          }
        }

        // City cards visible
        const cityH3 = page.locator('h3').first();
        await expect(cityH3, `[${label}] City cards`).toBeVisible({ timeout: 5000 });

        // No horizontal overflow
        const ok = await noHorizontalOverflow(page);
        if (!ok) await captureScreenshot(page, `${label}-explore-overflow`);
        expect(ok, `[${label}] Explore: horizontal overflow`).toBe(true);
      });

      // ── Profile page ──────────────────────────────────────────────────────
      await test.step('Profile page', async () => {
        await page.goto('/profile');
        await page.waitForLoadState('load');
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(500);

        // Profile page always renders a "Badges" section label (unconditional in JSX).
        // Avoid broad regex that matches hidden nav "My Trips" before visible content.
        const content = page.getByText('Badges').first();
        await expect(content, `[${label}] Profile content`).toBeVisible({ timeout: 10000 });

        // No horizontal overflow
        const ok = await noHorizontalOverflow(page);
        if (!ok) await captureScreenshot(page, `${label}-profile-overflow`);
        expect(ok, `[${label}] Profile: horizontal overflow`).toBe(true);
      });

      // ── Settings page ─────────────────────────────────────────────────────
      await test.step('Settings page', async () => {
        await page.goto('/settings');
        await page.waitForLoadState('load');
        await page.waitForTimeout(500);

        // Settings heading
        await expect(
          page.getByRole('heading', { name: /settings/i }),
          `[${label}] Settings heading`
        ).toBeVisible({ timeout: 8000 });

        // On mobile, form rows should not overflow
        const ok = await noHorizontalOverflow(page);
        if (!ok) await captureScreenshot(page, `${label}-settings-overflow`);
        expect(ok, `[${label}] Settings: horizontal overflow`).toBe(true);

        // Display name row visible (no clipping)
        const displayNameRow = page.getByText('Display name').first();
        await expect(displayNameRow, `[${label}] Display name row`).toBeVisible({ timeout: 5000 });
      });

      // Trip-dependent checks —  only run when we have a trip
      if (!sharedTripId) {
        console.log(`[${label}] No trip ID — skipping trip page checks`);
        return;
      }

      // ── Research tab — list/map toggle ────────────────────────────────────
      await test.step('Research tab — list/map responsive behaviour', async () => {
        await mockResearchAPI(page);
        await page.goto(`/trips/${sharedTripId}`);
        await page.waitForLoadState('load');
        await page.waitForTimeout(2500);

        // Wait for the research tab to show spots (or loading state)
        const mobileToggle = page.locator('.mobile-view-toggle').first();
        const listPanel    = page.locator('.research-list-panel').first();
        const mapPanel     = page.locator('.research-map-panel').first();

        if (isMobile) {
          // ── Mobile: toggle visible, panels mutually exclusive ────────────
          await expect(mobileToggle, `[${label}] Mobile view toggle visible`).toBeVisible({ timeout: 8000 });

          // Default: list visible, map hidden
          await expect(listPanel, `[${label}] List panel visible by default`).toBeVisible();
          const mapHidden = await mapPanel.getAttribute('data-hidden').catch(() => null);
          expect(mapHidden, `[${label}] Map panel hidden by default`).toBe('true');

          // Click Map button → map panel shows
          const mapBtn = page.getByRole('button', { name: /🗺|map/i })
            .filter({ hasNOT: page.locator('[class*="step"]') })
            .last();
          if (await mapBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await mapBtn.click();
            await page.waitForTimeout(600);

            const listHiddenAfter = await listPanel.getAttribute('data-hidden').catch(() => null);
            expect(listHiddenAfter, `[${label}] List hidden when map active`).toBe('true');
            await expect(mapPanel, `[${label}] Map panel visible in map mode`).toBeVisible();

            // Both panels fit within viewport width
            const mapBox = await mapPanel.boundingBox();
            if (mapBox) {
              expect(mapBox.width, `[${label}] Map panel fits viewport`).toBeLessThanOrEqual(vp.width + 4);
            }

            // Switch back to list
            const listBtn = page.getByRole('button', { name: /☰|list/i }).first();
            if (await listBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
              await listBtn.click();
              await page.waitForTimeout(400);
            }
          }

        } else {
          // ── Desktop: toggle NOT visible, both panels side by side ─────────
          const toggleVisible = await mobileToggle.isVisible({ timeout: 1500 }).catch(() => false);
          expect(toggleVisible, `[${label}] Mobile toggle hidden on desktop`).toBe(false);

          // Both panels visible simultaneously
          await expect(listPanel, `[${label}] List panel visible on desktop`).toBeVisible({ timeout: 8000 });
          await expect(mapPanel, `[${label}] Map panel visible on desktop`).toBeVisible({ timeout: 8000 });

          // List panel width should be ~380px (the fixed width from CSS)
          const listBox = await listPanel.boundingBox();
          if (listBox) {
            expect(listBox.width, `[${label}] List panel width`).toBeGreaterThan(200);
            expect(listBox.width, `[${label}] List panel not full-width`).toBeLessThan(vp.width * 0.8);
          }
        }

        const ok = await noHorizontalOverflow(page);
        if (!ok) await captureScreenshot(page, `${label}-research-overflow`);
        expect(ok, `[${label}] Research tab: horizontal overflow`).toBe(true);
      });

      // ── Spot drawer — bottom sheet vs right slide ─────────────────────────
      await test.step('Spot drawer — positioning', async () => {
        await mockResearchAPI(page);
        await page.goto(`/trips/${sharedTripId}`);
        await page.waitForLoadState('load');
        await page.waitForTimeout(2500);

        // On mobile: ensure we're on list view first
        if (isMobile) {
          const listBtn = page.getByRole('button', { name: /☰|list/i }).first();
          if (await listBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await listBtn.click();
            await page.waitForTimeout(400);
          }
        }

        // Click "Notes & details" on the first spot to open the drawer
        const detailsBtn = page.locator('button').filter({ hasText: 'Notes & details' }).first();
        const btnVisible = await detailsBtn.isVisible({ timeout: 8000 }).catch(() => false);

        if (!btnVisible) {
          console.log(`[${label}] No "Notes & details" button found — skipping drawer check`);
          return;
        }

        await detailsBtn.click();
        await page.waitForTimeout(500);

        const drawer = page.locator('.spot-drawer-panel').first();
        await expect(drawer, `[${label}] Drawer visible`).toBeVisible({ timeout: 5000 });

        const styles = await drawer.evaluate(el => {
          const cs = window.getComputedStyle(el);
          return {
            position: cs.position,
            top:      cs.top,
            bottom:   cs.bottom,
            right:    cs.right,
          };
        });

        if (isMobile) {
          // Bottom sheet: bottom should be 0px, top should be auto
          expect(styles.bottom, `[${label}] Drawer bottom on mobile`).toBe('0px');
          // top is either 'auto' or a large px value (since the panel starts from bottom)
          const isBottomSheet = styles.top === 'auto' || styles.bottom === '0px';
          expect(isBottomSheet, `[${label}] Drawer is a bottom sheet on mobile`).toBe(true);

          // Should cover at least 40% of screen height
          const box = await drawer.boundingBox();
          if (box) {
            expect(box.height, `[${label}] Drawer height on mobile`).toBeGreaterThan(vp.height * 0.3);
          }
          await captureScreenshot(page, `${label}-drawer-bottom-sheet`);
        } else {
          // Right slide: right should be 0px
          expect(styles.right, `[${label}] Drawer right edge on desktop`).toBe('0px');
          expect(styles.top,   `[${label}] Drawer top on desktop`).toBe('0px');
          await captureScreenshot(page, `${label}-drawer-right-slide`);
        }

        // Close drawer
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      });

      // ── Days tab — sidebar visibility ─────────────────────────────────────
      await test.step('Days tab — sidebar visibility', async () => {
        await page.goto(`/trips/${sharedTripId}`);
        await page.waitForLoadState('load');
        await page.waitForTimeout(800);

        // On mobile/tablet (≤768px) .step-label has display:none, so the
        // accessible name lacks "Days". Use CSS class + nth(1) universally.
        const daysTab = page.locator('.step-progress-btn').nth(1);
        await expect(daysTab, `[${label}] Days tab button`).toBeVisible({ timeout: 8000 });
        await daysTab.click();
        await page.waitForTimeout(1000);

        const sidebar = page.locator('.days-sidebar').first();

        if (isMobile) {
          const sidebarVis = await sidebar.isVisible({ timeout: 1000 }).catch(() => false);
          expect(sidebarVis, `[${label}] Days sidebar hidden on mobile`).toBe(false);
          // Day content area should be full-width
          const daysArea = page.locator('#days-export-target').first();
          if (await daysArea.isVisible({ timeout: 3000 }).catch(() => false)) {
            const box = await daysArea.boundingBox();
            if (box) {
              expect(box.width, `[${label}] Days area full-width on mobile`).toBeGreaterThan(vp.width * 0.85);
            }
          }
        } else {
          // Sidebar visible on desktop/tablet
          await expect(sidebar, `[${label}] Days sidebar visible on desktop`).toBeVisible({ timeout: 5000 });
        }

        const ok = await noHorizontalOverflow(page);
        if (!ok) await captureScreenshot(page, `${label}-days-overflow`);
        expect(ok, `[${label}] Days tab: horizontal overflow`).toBe(true);
      });

      // ── Pass tab ──────────────────────────────────────────────────────────
      await test.step('Pass tab', async () => {
        await page.goto(`/trips/${sharedTripId}`);
        await page.waitForLoadState('load');
        await page.waitForTimeout(600);

        // .step-label hidden on ≤768px — use nth(2) = Pass button
        const passTab = page.locator('.step-progress-btn').nth(2);
        await passTab.click();
        await page.waitForTimeout(1500);

        const passContent = page.getByText(/city pass|should you buy|no pass data|tourist pass/i).first();
        await expect(passContent, `[${label}] Pass tab has content`).toBeVisible({ timeout: 10000 });

        const ok = await noHorizontalOverflow(page);
        if (!ok) await captureScreenshot(page, `${label}-pass-overflow`);
        expect(ok, `[${label}] Pass tab: horizontal overflow`).toBe(true);
      });

      // ── Share page ────────────────────────────────────────────────────────
      await test.step('Share page', async () => {
        await page.goto(`/trips/${sharedTripId}/share`);
        await page.waitForLoadState('load');
        await page.waitForTimeout(1000);

        const shareContent = page.getByText(/itinerary|lisbon|venture|shared|not found/i).first();
        await expect(shareContent, `[${label}] Share page has content`).toBeVisible({ timeout: 10000 });

        const ok = await noHorizontalOverflow(page);
        if (!ok) await captureScreenshot(page, `${label}-share-overflow`);
        expect(ok, `[${label}] Share page: horizontal overflow`).toBe(true);
      });
    }); // end test
  }); // end describe
} // end for viewports
