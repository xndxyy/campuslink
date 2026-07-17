import { expect, test, type Page } from '../helpers/playwright-e2e';
import { shouldRunSharedAccountE2e } from '../helpers/e2e-environment';

const layoutUrl = process.env.FORUM_LAYOUT_URL?.trim();
const runLiveE2e = layoutUrl ? false : shouldRunSharedAccountE2e(process.env);
test.skip(
  !layoutUrl && !runLiveE2e,
  'Requires an explicit visual harness or complete live E2E services.',
);

async function expectForumMastheadSpacing(page: Page) {
  const masthead = await page.locator('.forum-masthead').boundingBox();
  const callToAction = await page
    .locator('.forum-masthead .primary-link')
    .boundingBox();
  const tabs = await page.locator('.forum-tabs').boundingBox();
  expect(masthead).not.toBeNull();
  expect(callToAction).not.toBeNull();
  expect(tabs).not.toBeNull();
  expect(callToAction!.y + callToAction!.height).toBeLessThanOrEqual(
    tabs!.y - 8,
  );
  expect(masthead!.y + masthead!.height).toBeLessThanOrEqual(tabs!.y);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const viewport of [
  { height: 900, name: 'desktop', width: 1280 },
  { height: 844, name: 'mobile', width: 390 },
]) {
  test(`forum masthead keeps actions clear at ${viewport.name} size`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(layoutUrl || '/forum');
    await expectForumMastheadSpacing(page);
  });
}
