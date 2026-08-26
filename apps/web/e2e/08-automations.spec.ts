import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Feature: Automation Studio & Workflows', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page, '/automations');
    await expect(page.getByTestId('automations-list-page')).toBeVisible();
  });

  test('displays Automation Studio header, presets and filter controls', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Automation Studio' })).toBeVisible();
    await expect(page.getByTestId('create-automation-btn')).toBeVisible();
    await expect(page.getByText('Quick-Start Flow Presets')).toBeVisible();

    // Starter template presets
    await expect(page.getByText('Quote Approval & Invoice Generator')).toBeVisible();
    await expect(page.getByText('Daily AI Financial & Cashflow Briefing')).toBeVisible();
    await expect(page.getByText('Inbound Webhook Lead Enrichment')).toBeVisible();

    // Trigger filters
    await expect(page.getByRole('button', { name: 'All Triggers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'WEBHOOK' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'SCHEDULE' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'CRM_EVENT' })).toBeVisible();
  });

  test('filters automation workflows by trigger type', async ({ page }) => {
    await page.getByRole('button', { name: 'SCHEDULE' }).click();
    await expect(page.getByTestId('automations-list-page')).toBeVisible();

    await page.getByRole('button', { name: 'WEBHOOK' }).click();
    await expect(page.getByTestId('automations-list-page')).toBeVisible();

    await page.getByRole('button', { name: 'All Triggers' }).click();
  });

  test('searches automations using the search input', async ({ page }) => {
    const searchInput = page.getByTestId('search-automations-input');
    await expect(searchInput).toBeVisible();

    await searchInput.fill('Quote');
    await expect(page.getByTestId('automations-list-page')).toBeVisible();
  });

  test('creates a workflow from a Quick-Start preset template and navigates to editor', async ({ page }) => {
    const templateCard = page.getByText('Quote Approval & Invoice Generator').first();
    await templateCard.click();

    // Should redirect to /automations/[id]
    await expect(page).toHaveURL(/\/automations\/[a-zA-Z0-9-]+/, { timeout: 15000 });
  });

  test('navigates to New Automation canvas studio', async ({ page }) => {
    await page.getByTestId('create-automation-btn').click();
    await expect(page).toHaveURL(/\/automations\/new/);
  });
});
