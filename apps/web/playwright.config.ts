import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright E2E configuration for Relay CRM Web Application.
 * Follows patterns from playwright-skill for robust Next.js + NestJS testing.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter api start:dev',
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: true,
      timeout: 120000,
      cwd: path.resolve(__dirname, '../..'),
    },
    {
      command: 'pnpm --filter web dev',
      url: 'http://localhost:3000/login',
      reuseExistingServer: true,
      timeout: 120000,
      cwd: path.resolve(__dirname, '../..'),
    },
  ],
});
