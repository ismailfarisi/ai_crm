import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Feature: Quotes & Workflow Orchestration', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page, '/quotes');
    await expect(page.getByRole('heading', { name: /Quotes/ })).toBeVisible();
  });

  test('renders quotes overview page with stats and actions', async ({ page }) => {
    await expect(page.getByText('Total Quotes')).toBeVisible();
    await expect(page.getByText('Awaiting Approval')).toBeVisible();
    await expect(page.getByText('Approved')).toBeVisible();
    await expect(page.getByText('Total Value')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Quick AI Modal' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New Quotation' })).toBeVisible();
  });

  test('opens quick AI modal and switches between AI and manual tabs', async ({ page }) => {
    await page.getByRole('button', { name: 'Quick AI Modal' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Create New Quote' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'AI Agent Draft' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Manual Entry' })).toBeVisible();

    // Switch to manual
    await dialog.getByRole('button', { name: 'Manual Entry' }).click();
    await expect(dialog.getByText('Line Items')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add Item' })).toBeVisible();

    // Close modal
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('builds and saves a full quotation in Quote Editor', async ({ page }) => {
    await page.getByRole('link', { name: 'New Quotation' }).click();
    await expect(page).toHaveURL(/\/quotes\/new/);

    const uniqueId = Date.now();
    const quoteTitle = `Enterprise Cloud Migration ${uniqueId}`;

    // Fill Title
    const titleInput = page.getByPlaceholder(/e\.g\., Acme Enterprise|Quotation title/i).first();
    if (await titleInput.isVisible()) {
      await titleInput.fill(quoteTitle);
    } else {
      await page.locator('input').first().fill(quoteTitle);
    }

    // Save Draft
    await page.getByRole('button', { name: 'Save Draft' }).click();
    await expect(page.getByText(/Quotation draft updated|New quotation created/i)).toBeVisible({ timeout: 10000 });
  });

  test('opens Print and PDF preview modal', async ({ page }) => {
    await page.getByRole('link', { name: 'New Quotation' }).click();
    await page.waitForURL(/\/quotes\/new/);

    await page.getByRole('button', { name: 'Preview / Print' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Quotation Document Preview' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Print / Save as PDF' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
  });
});
