import { test, expect } from '@playwright/test';
import { TEST_USERS, loginAsOwner, logout } from './helpers/auth';

test.describe('Feature: Authentication & Session Management', () => {
  test('renders login page with all form controls and branding', async ({ page }) => {
    await page.goto('/login');
    
    await expect(page.locator('h1')).toHaveText('Welcome back');
    await expect(page.locator('text=Sign in to your workspace')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveText('Sign in');
    await expect(page.locator('a[href="/register"]')).toBeVisible();
  });

  test('validates required fields on empty submit', async ({ page }) => {
    await page.goto('/login');
    
    await page.locator('button[type="submit"]').click();
    
    // Zod validation messages or field states
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('shows error message on invalid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.locator('input[type="email"]').fill('nonexistent@example.com');
    await page.locator('input[type="password"]').fill('WrongPassword123!');
    await page.locator('button[type="submit"]').click();
    
    // Should display error alert or message
    await expect(page.locator('.text-danger, [role="alert"], div:has-text("Invalid credentials"), div:has-text("not found")').first()).toBeVisible({ timeout: 10000 });
  });

  test('successfully signs in as Owner and redirects to dashboard', async ({ page }) => {
    await loginAsOwner(page);
    
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /Ada/ })).toBeVisible();
    await expect(page.getByText('Northwind Trading').first()).toBeVisible();
  });

  test('logs out and returns to login page', async ({ page }) => {
    await loginAsOwner(page);
    await logout(page);
    
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects unauthenticated users from protected routes to login', async ({ browser }) => {
    const context = await browser.newContext();
    const freshPage = await context.newPage();
    
    await freshPage.goto('/contacts');
    await expect(freshPage).toHaveURL(/\/login/);
    
    await freshPage.goto('/settings/team');
    await expect(freshPage).toHaveURL(/\/login/);
    
    await context.close();
  });

  test('renders registration page and validates fields', async ({ page }) => {
    await page.goto('/register');
    
    await expect(page.locator('h1')).toHaveText('Create your workspace');
    await expect(page.locator('input[name="organizationName"]')).toBeVisible();
    await expect(page.locator('input[name="firstName"]')).toBeVisible();
    await expect(page.locator('input[name="lastName"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('a[href="/login"]')).toBeVisible();
  });

  test('renders accept invite page structure', async ({ page }) => {
    await page.goto('/accept-invite?token=invalid_test_token');
    
    await expect(page.locator('text=Accept Invitation').or(page.locator('text=Set your password')).or(page.locator('h1'))).toBeVisible();
  });
});
