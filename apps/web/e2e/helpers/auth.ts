import { Page, expect } from '@playwright/test';

export const TEST_USERS = {
  owner: {
    email: 'owner@northwind.test',
    password: 'Password123!',
    fullName: 'Ada Okonkwo',
    role: 'Owner',
  },
  admin: {
    email: 'admin@northwind.test',
    password: 'Password123!',
    fullName: 'Grace Bello',
    role: 'Admin',
  },
  manager: {
    email: 'manager@northwind.test',
    password: 'Password123!',
    fullName: 'Ravi Kapoor',
    role: 'Manager',
  },
  rep: {
    email: 'rep@northwind.test',
    password: 'Password123!',
    fullName: 'Lena Fischer',
    role: 'Member',
  },
  viewer: {
    email: 'viewer@northwind.test',
    password: 'Password123!',
    fullName: 'Tom Adeyemi',
    role: 'Viewer',
  },
};

/**
 * Log in with specific user credentials and navigate directly to target path.
 */
export async function loginAs(
  page: Page,
  user: { email: string; password: string },
  nextPath = '/dashboard',
) {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  
  // Fill in email and password
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  
  // Submit the form
  await page.locator('button[type="submit"]').click();
  
  // Wait for direct redirect to target page
  await page.waitForURL(`**${nextPath}`, { timeout: 15000 });
}

/**
 * Convenience helper to log in as organization owner.
 */
export async function loginAsOwner(page: Page, nextPath = '/dashboard') {
  await loginAs(page, TEST_USERS.owner, nextPath);
}

/**
 * Convenience helper to log in as organization admin.
 */
export async function loginAsAdmin(page: Page, nextPath = '/dashboard') {
  await loginAs(page, TEST_USERS.admin, nextPath);
}

/**
 * Convenience helper to log in as team manager.
 */
export async function loginAsManager(page: Page, nextPath = '/dashboard') {
  await loginAs(page, TEST_USERS.manager, nextPath);
}

/**
 * Convenience helper to log in as sales rep (member).
 */
export async function loginAsRep(page: Page, nextPath = '/dashboard') {
  await loginAs(page, TEST_USERS.rep, nextPath);
}

/**
 * Convenience helper to log in as read-only viewer.
 */
export async function loginAsViewer(page: Page, nextPath = '/dashboard') {
  await loginAs(page, TEST_USERS.viewer, nextPath);
}

/**
 * Log out from the application using the UserCard sign out button.
 */
export async function logout(page: Page) {
  const logoutButton = page.locator('button[aria-label="Sign out"]');
  if (await logoutButton.isVisible()) {
    await logoutButton.click();
    await page.waitForURL('**/login', { timeout: 10000 });
  }
}
