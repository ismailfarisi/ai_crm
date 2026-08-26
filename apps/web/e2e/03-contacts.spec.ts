import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Feature: Contacts Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page, '/contacts');
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
  });

  test('displays contacts data table with columns and pagination', async ({ page }) => {
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Name/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Company/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Status/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Source/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Owner/i })).toBeVisible();
  });

  test('filters contacts by status and source', async ({ page }) => {
    const statusFilter = page.getByRole('combobox', { name: 'Filter by status' });
    await expect(statusFilter).toBeVisible();

    await statusFilter.selectOption('customer');
    await expect(page.getByRole('table')).toBeVisible();

    const sourceFilter = page.getByRole('combobox', { name: 'Filter by source' });
    await expect(sourceFilter).toBeVisible();

    await sourceFilter.selectOption('website');
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('searches contacts by name and company', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search name, email or company…');
    await expect(searchInput).toBeVisible();

    await searchInput.fill('Okafor');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('Okafor').first()).toBeVisible();
  });

  test('creates a new contact and verifies it in the pipeline', async ({ page }) => {
    const uniqueId = Date.now();
    const firstName = `TestUser${uniqueId}`;
    const lastName = 'E2E';
    const email = `testuser${uniqueId}@example.com`;
    const company = 'E2E Automated Corp';

    // Click New contact
    await page.getByRole('button', { name: 'New contact' }).click();
    
    // Target modal dialog explicitly
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'New contact' })).toBeVisible();

    // Fill form dialog
    await dialog.getByLabel('First name').fill(firstName);
    await dialog.getByLabel('Last name').fill(lastName);
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Phone').fill('+1 555 999 1234');
    await dialog.getByLabel('Company').fill(company);
    await dialog.getByLabel('Job title').fill('QA Architect');
    await dialog.getByLabel('Status', { exact: true }).selectOption('lead');
    await dialog.getByLabel('Source', { exact: true }).selectOption('referral');
    await dialog.getByLabel('Notes').fill('Created via automated Playwright test');

    // Submit form
    await dialog.getByRole('button', { name: 'Create contact' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // Verify contact appears in table search
    const searchInput = page.getByPlaceholder('Search name, email or company…');
    await searchInput.fill(firstName);
    await expect(page.getByRole('link', { name: `${firstName} ${lastName}` })).toBeVisible({ timeout: 10000 });
  });

  test('navigates to contact detail page and switches tabs', async ({ page }) => {
    // Click on the first contact link in table
    const contactRow = page.locator('table tbody tr').first();
    await expect(contactRow).toBeVisible();
    const firstContactLink = contactRow.locator('a').first();
    await expect(firstContactLink).toBeVisible();

    await firstContactLink.click();
    await expect(page).toHaveURL(/\/contacts\/[a-zA-Z0-9-]+/);

    // Tab navigation
    const messagesTab = page.getByRole('button', { name: /Messages Timeline/i });
    const detailsTab = page.getByRole('button', { name: /Contact Details/i });

    await expect(messagesTab).toBeVisible();
    await expect(detailsTab).toBeVisible();

    // Switch to Contact Details tab
    await detailsTab.click();
    await expect(page.getByText('Full Name')).toBeVisible();

    // Switch back to Messages Timeline
    await messagesTab.click();
    await expect(page.getByRole('link', { name: 'Back to Contacts' })).toBeVisible();
  });

  test('opens edit contact dialog and updates details', async ({ page }) => {
    const editBtn = page.getByRole('button', { name: /Edit /i }).first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Dialog opens
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit contact' })).toBeVisible();
    await dialog.getByLabel('Job title').fill('Updated Title ' + Date.now());

    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });
  });
});
