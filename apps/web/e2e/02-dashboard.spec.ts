import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Feature: Dashboard & Analytics', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
  });

  test('displays greeting header with user and organization name', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Ada/ })).toBeVisible();
    await expect(page.getByText('Northwind Trading').first()).toBeVisible();
  });

  test('renders top KPI stat chips and win rate gauge widget', async ({ page }) => {
    // 4 Key Stat Chips
    await expect(page.getByText('Total contacts')).toBeVisible();
    await expect(page.getByText('Added this week')).toBeVisible();
    await expect(page.getByText('Added this month')).toBeVisible();
    await expect(page.getByText('Active Customers')).toBeVisible();

    // Win Rate Gauge Widget
    await expect(page.getByText('Quotation Win Rate')).toBeVisible();
    await expect(page.getByText('Customer Satisfaction')).toBeVisible();
    await expect(page.getByText('84%')).toBeVisible();
  });

  test('renders golden wave KPI velocity chart and interactive period selectors', async ({ page }) => {
    await expect(page.getByText('Revenue & Conversion Velocity')).toBeVisible();
    await expect(page.getByText('72.4%')).toBeVisible();
    await expect(page.getByText('+14.8% YoY')).toBeVisible();

    // Period buttons (30D, 90D, 1Y)
    const btn30D = page.getByRole('button', { name: '30D' });
    const btn90D = page.getByRole('button', { name: '90D' });
    const btn1Y = page.getByRole('button', { name: '1Y' });

    await expect(btn30D).toBeVisible();
    await expect(btn90D).toBeVisible();
    await expect(btn1Y).toBeVisible();

    // Switch periods
    await btn30D.click();
    await btn90D.click();
    await btn1Y.click();
  });

  test('renders pipeline breakdown and RBAC permissions card', async ({ page }) => {
    await expect(page.getByText('Contacts Pipeline by Status')).toBeVisible();
    await expect(page.getByText('Your Access & Roles')).toBeVisible();
    await expect(page.getByText('Assigned Roles')).toBeVisible();
    await expect(page.getByText('Owner').first()).toBeVisible();
  });

  test('theme toggle switches theme classes on root element', async ({ page }) => {
    const themeButton = page.getByRole('button', { name: /Switch to (dark|light) theme/ });
    await expect(themeButton).toBeVisible();

    const isInitiallyDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await themeButton.click();
    
    const isDarkAfterClick = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDarkAfterClick).toBe(!isInitiallyDark);

    // Toggle back
    await themeButton.click();
    const isDarkRestored = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(isDarkRestored).toBe(isInitiallyDark);
  });

  test('quick action buttons navigate to respective pages', async ({ page }) => {
    await page.getByRole('link', { name: 'Create Quote' }).click();
    await expect(page).toHaveURL(/\/quotes\/new/);

    await page.goto('/dashboard');
    await page.getByRole('link', { name: 'View Contacts' }).first().click();
    await expect(page).toHaveURL(/\/contacts/);
  });
});
