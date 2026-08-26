import { test, expect } from '@playwright/test';
import { loginAsOwner } from './helpers/auth';

test.describe('Feature: Settings & Workspace Administration', () => {
  test.describe('Team Members (/settings/team)', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page, '/settings/team');
      await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    });

    test('displays team roster and user roles', async ({ page }) => {
      const main = page.getByRole('main');
      await expect(main.getByText('Ada Okonkwo')).toBeVisible();
      await expect(main.getByText('Grace Bello')).toBeVisible();
      await expect(main.getByText('Ravi Kapoor')).toBeVisible();
      await expect(main.getByText('Lena Fischer')).toBeVisible();
      await expect(main.getByText('Tom Adeyemi')).toBeVisible();

      await expect(main.getByRole('button', { name: 'Add member' })).toBeVisible();
    });

    test('opens Add Member invitation dialog and validates form', async ({ page }) => {
      await page.getByRole('button', { name: 'Add member' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Add a team member' })).toBeVisible();
      await expect(dialog.getByLabel('First name')).toBeVisible();
      await expect(dialog.getByLabel('Last name')).toBeVisible();
      await expect(dialog.getByLabel('Email')).toBeVisible();

      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
    });
  });

  test.describe('Teams Management (/settings/teams)', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page, '/settings/teams');
      await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible();
    });

    test('displays existing teams and creates a new team', async ({ page }) => {
      await expect(page.getByText('Enterprise Sales')).toBeVisible();

      const newTeamBtn = page.getByRole('button', { name: 'New team' }).first();
      await newTeamBtn.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'New team' })).toBeVisible();
      const uniqueId = Date.now();
      const teamName = `Operations ${uniqueId}`;

      const teamInput = dialog.getByLabel('Team name');
      await teamInput.fill(teamName);
      await dialog.getByRole('button', { name: 'Create team' }).click();

      await expect(dialog).toBeHidden({ timeout: 10000 });
      await expect(page.getByRole('heading', { name: teamName })).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Roles & Permissions Matrix (/settings/roles)', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page, '/settings/roles');
      await expect(page.getByRole('heading', { name: 'Roles & permissions' })).toBeVisible();
    });

    test('displays system roles and inspects permission matrix', async ({ page }) => {
      await expect(page.getByRole('button', { name: /Owner/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Admin/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Manager/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Member/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Viewer/i })).toBeVisible();

      await page.getByRole('button', { name: /Manager/i }).click();
      await expect(page.getByRole('heading', { name: /Manager/i })).toBeVisible();

      await expect(page.getByRole('button', { name: 'New role' })).toBeVisible();
    });
  });

  test.describe('Communication Channels (/settings/channels)', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsOwner(page, '/settings/channels');
      await expect(page.getByRole('heading', { name: 'Communication Channels' })).toBeVisible();
    });

    test('displays all 4 channel integration cards and opens config modal', async ({ page }) => {
      await expect(page.getByText(/WhatsApp/i).first()).toBeVisible();
      await expect(page.getByText(/Telegram/i).first()).toBeVisible();
      await expect(page.getByText(/SMTP/i).first()).toBeVisible();
      await expect(page.getByText(/Resend/i).first()).toBeVisible();

      const configBtn = page.getByRole('button', { name: /Configure/i }).first();
      await configBtn.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: /Configuration/i })).toBeVisible();
      await dialog.getByRole('button', { name: /Cancel/i }).click();
      await expect(dialog).toBeHidden();
    });
  });
});
