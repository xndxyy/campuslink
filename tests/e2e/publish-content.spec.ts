import path from 'node:path';
import { expect, test } from '@playwright/test';
import { hasCompleteE2eEnvironment } from '../helpers/e2e-environment';

test.skip(
  !hasCompleteE2eEnvironment(process.env),
  'Requires complete live E2E services and provisioned accounts.',
);

async function signIn(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
) {
  await page.goto('/auth/sign-in');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);
}

test('verified student publishes resource, marketplace item, and job through real forms', async ({
  page,
}) => {
  const runId = Date.now().toString(36);
  const resourceTitle = `E2E algorithms notes ${runId}`;
  const marketplaceTitle = `E2E textbook ${runId}`;
  const jobTitle = `E2E weekend assistant ${runId}`;
  await signIn(
    page,
    process.env.E2E_VERIFIED_EMAIL!,
    process.env.E2E_VERIFIED_PASSWORD!,
  );

  await page.goto('/submit/resource');
  await page.locator('input[name="title"]').fill(resourceTitle);
  await page
    .locator('textarea[name="summary"]')
    .fill('Complete E2E lecture notes with worked examples and exercises.');
  await page.locator('input[name="tags"]').fill('e2e, algorithms');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve('tests/fixtures/resource.pdf'));
  await expect(page.getByText('Upload is ready.')).toBeVisible();
  await page.locator('button[type="submit"]').last().click();
  await expect(page.locator('[aria-live="polite"]').last()).toContainText(
    '审核',
  );

  await page.goto('/submit/marketplace');
  await page.locator('input[name="title"]').fill(marketplaceTitle);
  await page
    .locator('textarea[name="description"]')
    .fill('A carefully used E2E discrete mathematics textbook.');
  await page.locator('input[name="price"]').fill('19.99');
  await page.locator('input[name="pickupArea"]').fill('North library');
  await page.locator('textarea[name="contact"]').fill('Private campus inbox');
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('tests/fixtures/marketplace.png'));
  await expect(page.getByText('Upload is ready.')).toBeVisible();
  await page.locator('button[type="submit"]').last().click();
  await expect(page.locator('[aria-live="polite"]').last()).toContainText(
    '审核',
  );

  await page.goto('/submit/job');
  await page.locator('input[name="company"]').fill('E2E Campus Cafe');
  await page.locator('input[name="title"]').fill(jobTitle);
  await page
    .locator('textarea[name="description"]')
    .fill('Help serve students during the E2E weekend lunch shift.');
  await page.locator('input[name="location"]').fill('Student centre');
  await page.locator('input[name="payText"]').fill('$20/hour');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('[aria-live="polite"]')).toContainText('审核');

  await page.goto('/me/submissions');
  for (const title of [resourceTitle, marketplaceTitle, jobTitle]) {
    const row = page.locator('article').filter({ hasText: title }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('PENDING');
  }
});

test('published marketplace image renders through the protected signed-read route', async ({
  page,
}) => {
  await page.goto(`/marketplace/${process.env.E2E_PUBLISHED_MARKETPLACE_ID!}`);
  const image = page.locator('img[src*="/api/assets/"][src$="/read"]').first();
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return img.complete && img.naturalWidth > 0;
      }),
    )
    .toBe(true);
});

test('unverified account is denied sign-in', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await page
    .locator('input[name="email"]')
    .fill(process.env.E2E_UNVERIFIED_EMAIL!);
  await page
    .locator('input[name="password"]')
    .fill(process.env.E2E_UNVERIFIED_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/auth\/sign-in\?error=/);
});

test('owner edits a provisioned rejected record and resubmits it', async ({
  page,
}) => {
  await signIn(
    page,
    process.env.E2E_VERIFIED_EMAIL!,
    process.env.E2E_VERIFIED_PASSWORD!,
  );
  const kind = process.env.E2E_REJECTED_KIND!;
  const id = process.env.E2E_REJECTED_ID!;
  await page.goto(`/me/submissions/${kind}/${id}/edit`);
  await page.locator('input[name="title"]').fill(`Revised rejected ${kind}`);
  await page.getByRole('button', { name: '保存草稿' }).click();
  await expect(page).toHaveURL(/me\/submissions/);
  const row = page
    .locator('article')
    .filter({ hasText: `Revised rejected ${kind}` });
  await expect(row).toContainText('DRAFT');
  await row.getByRole('button', { name: '重新提交' }).click();
  await expect(row).toContainText('PENDING');
});
