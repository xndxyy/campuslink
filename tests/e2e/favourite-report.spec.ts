import { expect, test } from '@playwright/test';
import { hasCompleteE2eEnvironment } from '../helpers/e2e-environment';

test.skip(
  !hasCompleteE2eEnvironment(process.env),
  'Requires complete live E2E services and provisioned accounts.',
);

test('verified member favourites, reports, and requests marketplace contact', async ({
  page,
}) => {
  await page.goto('/auth/sign-in');
  await page
    .locator('input[name="email"]')
    .fill(process.env.E2E_VERIFIED_EMAIL!);
  await page
    .locator('input[name="password"]')
    .fill(process.env.E2E_VERIFIED_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);

  await page.goto(`/marketplace/${process.env.E2E_PUBLISHED_MARKETPLACE_ID!}`);
  const favourite = page.getByRole('button', { name: 'Add favourite' });
  await favourite.click();
  await expect(
    page.getByRole('button', { name: 'Remove favourite' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Report content' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report this content' });
  await dialog.getByLabel('Reason').selectOption('MISLEADING');
  await dialog
    .getByLabel('Optional details')
    .fill('E2E report submitted through the real published detail.');
  await dialog.getByRole('button', { name: 'Submit report' }).click();
  await expect(
    page.getByText(/Report received|open report already exists/),
  ).toBeVisible();

  await expect(page.locator('.revealed-contact')).toHaveCount(0);
  await page.getByRole('button', { name: 'Request contact' }).click();
  await expect(page.locator('.revealed-contact')).toBeVisible();
  await expect(page).not.toHaveURL(/contact=/);
});
