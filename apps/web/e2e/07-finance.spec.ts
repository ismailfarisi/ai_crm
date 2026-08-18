import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Feature: Finance & Treasury Suite', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page, '/finance');
    await expect(page.getByTestId('finance-nav')).toBeVisible();
  });

  test('displays finance navigation ribbon across all sub-modules', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Treasury Overview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Expenses & Receipts' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Category Budgets' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bank & Cash Accounts' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Subscriptions & SaaS' })).toBeVisible();
  });

  test('navigates to Bank & Cash Accounts and registers a new account', async ({ page }) => {
    await page.getByRole('link', { name: 'Bank & Cash Accounts' }).click();
    await expect(page).toHaveURL(/\/finance\/accounts/);

    const addAccountBtn = page.getByRole('button', { name: /Add Account|New Account|Create Account/i }).first();
    await expect(addAccountBtn).toBeVisible();
    await addAccountBtn.click();

    const uniqueId = Date.now();
    const accountName = `Treasury Reserve ${uniqueId}`;

    await page.getByTestId('input-account-name').fill(accountName);
    await page.getByTestId('input-initial-balance').fill('75000');
    await page.getByTestId('input-account-number').fill('9876543210');

    await page.getByTestId('btn-submit-account').click();

    // Verify account shows up in accounts list
    await expect(page.getByText(accountName)).toBeVisible({ timeout: 10000 });
  });

  test('navigates to Category Budgets and verifies budget view', async ({ page }) => {
    await page.getByRole('link', { name: 'Category Budgets' }).click();
    await expect(page).toHaveURL(/\/finance\/budgets/);
    await expect(page.getByText(/Budgets|Budget Allocations|Category/i).first()).toBeVisible();
  });

  test('navigates to Expenses & Receipts and checks expenses layout', async ({ page }) => {
    await page.getByRole('link', { name: 'Expenses & Receipts' }).click();
    await expect(page).toHaveURL(/\/finance\/expenses/);
    await expect(page.getByText(/Expenses|Receipts/i).first()).toBeVisible();
  });

  test('navigates to Subscriptions & SaaS and verifies subscription tracking', async ({ page }) => {
    await page.getByRole('link', { name: 'Subscriptions & SaaS' }).click();
    await expect(page).toHaveURL(/\/finance\/subscriptions/);
    await expect(page.getByText(/Subscriptions|SaaS|Monthly/i).first()).toBeVisible();
  });
});
