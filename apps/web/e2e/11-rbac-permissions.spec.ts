import { test, expect } from '@playwright/test';
import { loginAsViewer, loginAsRep, loginAsManager, loginAsAdmin, loginAsOwner } from './helpers/auth';

test.describe('Feature: Multi-Role RBAC & Access Control Scoping', () => {
  test('Viewer role has read-only contacts view without creation or mutation controls', async ({ page }) => {
    await loginAsViewer(page, '/contacts');

    // Page loads and displays contacts
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();

    // New contact button should NOT be visible
    await expect(page.getByRole('button', { name: 'New contact' })).toBeHidden();

    // Edit and Delete buttons should NOT be visible in actions column
    await expect(page.getByRole('button', { name: /Edit /i })).toBeHidden();
    await expect(page.getByRole('button', { name: /Delete /i })).toBeHidden();
  });

  test('Viewer is refused access from administrative channels settings', async ({ page }) => {
    await loginAsViewer(page, '/settings/channels');

    // PageGuard refuses access
    await expect(
      page.getByText(/You can't view this page|You don't have permission|Access denied|You can't manage channel settings/i)
        .or(page.getByRole('heading', { name: /You/i }))
    ).toBeVisible();
  });

  test('Manager role sees team-scoped pipeline and Enterprise Sales team badge', async ({ page }) => {
    await loginAsManager(page, '/contacts');

    // Contacts page reflects team scope description
    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
    await expect(page.getByText(/Your team's pipeline|contacts owned by you and your team/i)).toBeVisible();

    // Settings -> Teams shows "You lead this"
    await page.goto('/settings/teams');
    await expect(page.getByText('Enterprise Sales')).toBeVisible();
    await expect(page.getByText('You lead this')).toBeVisible();
  });

  test('Sales Rep role sees only assigned contacts scope', async ({ page }) => {
    await loginAsRep(page, '/contacts');

    await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible();
    await expect(page.getByText(/The contacts assigned to you/i)).toBeVisible();
  });

  test('Owner role has complete pipeline visibility and all settings access', async ({ page }) => {
    await loginAsOwner(page, '/contacts');
    
    await expect(page.getByText(/Everyone in your organization's pipeline/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'New contact' })).toBeVisible();

    await page.goto('/settings/team');
    await expect(page.getByRole('button', { name: 'Add member' })).toBeVisible();

    await page.goto('/settings/roles');
    await expect(page.getByRole('button', { name: 'New role' })).toBeVisible();
  });
});
