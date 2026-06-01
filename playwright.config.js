// @ts-check
const { defineConfig, devices } = require('@playwright/test');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env.local') });

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,   // Journey tests must run in order
  retries: 0,
  workers: 1,

  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    colorScheme: 'dark',
    slowMo: 500,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,   // Reuse already-running dev server
    timeout: 120_000,
  },
});
