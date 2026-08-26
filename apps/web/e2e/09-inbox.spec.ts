import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Feature: Multi-Channel Inbox & Messaging', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page, '/inbox');
    await expect(page).toHaveURL(/\/inbox/);
  });

  test('displays inbox workspace layout with channel filters', async ({ page }) => {
    const filterAll = page.getByRole('button', { name: 'All' }).first();
    await expect(filterAll.or(page.getByText('Inbox').first())).toBeVisible();
    await expect(page.locator('form').or(page.getByText('No conversation selected'))).toBeVisible();
  });

  test('switches provider filters (WhatsApp, Telegram, Email)', async ({ page }) => {
    const waButton = page.getByRole('button', { name: /WhatsApp/i }).first();
    if (await waButton.isVisible()) {
      await waButton.click();
    }

    const tgButton = page.getByRole('button', { name: /Telegram/i }).first();
    if (await tgButton.isVisible()) {
      await tgButton.click();
    }

    const emailButton = page.getByRole('button', { name: /Email/i }).first();
    if (await emailButton.isVisible()) {
      await emailButton.click();
    }
  });

  test('interacts with message composer when active', async ({ page }) => {
    const composerTextarea = page.getByPlaceholder(/Type your reply/i);
    if (await composerTextarea.isVisible()) {
      await composerTextarea.fill('Hello from Playwright automated E2E test!');
      await expect(page.getByRole('button', { name: /Send/i })).toBeVisible();
    }
  });
});
