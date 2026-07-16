import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

import { shouldRunSharedAccountE2e } from '../helpers/e2e-environment';

const runE2e = shouldRunSharedAccountE2e(process.env);

test.skip(!runE2e, 'Requires live E2E services and provisioned fixtures.');

async function privateAssetId() {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM "Asset"
       WHERE "resourceId" = $1 AND kind = 'RESOURCE_DOCUMENT'
       ORDER BY id LIMIT 1`,
      [process.env.E2E_REJECTED_ID],
    );
    expect(result.rows[0]).toBeDefined();
    return result.rows[0]!.id;
  } finally {
    await db.end();
  }
}

async function signIn(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
) {
  await page.goto('/auth/sign-in');
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).not.toHaveURL(/auth\/sign-in/);
}

test('cross-origin authentication mutations are rejected before credentials', async ({
  request,
}) => {
  const response = await request.post('/api/auth/sign-in', {
    data: {
      email: process.env.E2E_VERIFIED_EMAIL,
      password: process.env.E2E_VERIFIED_PASSWORD,
    },
    headers: { origin: 'https://attacker.example' },
  });
  expect(response.status()).toBe(403);
});

test('anonymous mutations and private document reads do not reach protected data', async ({
  request,
}) => {
  const mutation = await request.post('/api/favourites', {
    data: {
      targetId: process.env.E2E_PUBLISHED_MARKETPLACE_ID,
      targetType: 'MARKETPLACE_ITEM',
    },
    headers: { origin: process.env.APP_URL! },
  });
  expect(mutation.status()).toBe(401);

  const read = await request.get(`/api/assets/${await privateAssetId()}/read`);
  expect(read.status()).toBe(401);
});

test('keyboard navigation opens the unified publish center', async ({
  page,
}) => {
  await page.goto('/');

  const publishLink = page.getByRole('link', { name: '发布内容' });
  await publishLink.focus();
  await expect(publishLink).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL('/submit/resource');
  await expect(page.getByRole('heading', { name: '发布内容' })).toBeVisible();
});

test('mobile header keeps all shared navigation links visible and focusable', async ({
  page,
}) => {
  await page.setViewportSize({ height: 900, width: 320 });
  await page.goto('/');

  const header = page.getByRole('banner');
  for (const name of [
    '学习资源',
    '二手交易',
    '校园工作',
    '校园论坛',
    '我的发布',
    '我的收藏',
  ]) {
    const link = header.getByRole('link', { exact: true, name });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await link.focus();
    await expect(link).toBeFocused();
  }
});

test('a signed-in non-owner receives 403 while the owner can obtain a signed read', async ({
  page,
}) => {
  const assetId = await privateAssetId();
  await signIn(
    page,
    process.env.E2E_OTHER_EMAIL!,
    process.env.E2E_OTHER_PASSWORD!,
  );
  const forbidden = await page
    .context()
    .request.get(`/api/assets/${assetId}/read`, { maxRedirects: 0 });
  expect(forbidden.status()).toBe(403);

  await page.context().clearCookies();
  await signIn(
    page,
    process.env.E2E_VERIFIED_EMAIL!,
    process.env.E2E_VERIFIED_PASSWORD!,
  );
  const ownerRead = await page
    .context()
    .request.get(`/api/assets/${assetId}/read`, { maxRedirects: 0 });
  expect(ownerRead.status()).toBe(307);
});
