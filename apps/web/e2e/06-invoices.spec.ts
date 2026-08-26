import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Feature: Invoices Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page, '/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  });

  test('displays invoice metrics and table overview', async ({ page }) => {
    await expect(page.getByText('Track issued and paid invoices generated from approved quotes.')).toBeVisible();
    await expect(page.getByText('Issued Invoices')).toBeVisible();
    await expect(page.getByText('Total Issued Amount')).toBeVisible();
    await expect(page.getByText('Paid Amount')).toBeVisible();
  });

  test('renders invoices table or empty state with search', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search invoices...');
    await expect(searchInput).toBeVisible();

    const tableOrEmpty = page.getByRole('table').or(page.getByText('No invoices found'));
    await expect(tableOrEmpty.first()).toBeVisible();
  });
});
