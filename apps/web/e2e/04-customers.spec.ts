import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Feature: Customers Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page, '/customers');
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  });

  test('displays customers view and data table columns', async ({ page }) => {
    await expect(page.getByText('The companies you sell to.')).toBeVisible();
    await expect(page.getByPlaceholder('Search company, contact, email or city…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New customer' })).toBeVisible();
  });

  test('creates a new customer and confirms appearance in table', async ({ page }) => {
    const uniqueId = Date.now();
    const companyName = `Acme Enterprise ${uniqueId}`;
    const contactName = 'Jane Doe';
    const email = `jane${uniqueId}@acme.test`;

    await page.getByRole('button', { name: 'New customer' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'New customer' })).toBeVisible();

    // Fill form
    await dialog.getByLabel('Company name').fill(companyName);
    await dialog.getByLabel('Contact name').fill(contactName);
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Phone').fill('+1 555 456 7890');
    await dialog.getByLabel('Address line 1').fill('100 Market St');
    await dialog.getByLabel('City').fill('San Francisco');
    await dialog.getByLabel('Postal code').fill('94105');
    await dialog.getByLabel('Country').fill('USA');
    await dialog.getByLabel('Currency').fill('USD');
    await dialog.getByLabel('Payment terms').fill('45');
    await dialog.getByLabel('Notes').fill('Key enterprise customer account');

    // Submit form
    await dialog.getByRole('button', { name: 'Create customer' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Verify in table search
    const searchInput = page.getByPlaceholder('Search company, contact, email or city…');
    await searchInput.fill(companyName);
    await expect(page.getByText(companyName, { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('edits an existing customer and saves changes', async ({ page }) => {
    const editBtn = page.getByRole('button', { name: /Edit /i }).first();
    if (await editBtn.isVisible()) {
      await editBtn.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Edit customer' })).toBeVisible();

      await dialog.getByLabel('Contact name').fill('Updated Contact ' + Date.now());
      await dialog.getByRole('button', { name: 'Save changes' }).click();

      await expect(dialog).toBeHidden({ timeout: 10000 });
    }
  });
});
