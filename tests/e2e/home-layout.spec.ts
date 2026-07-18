import { expect, test } from '../helpers/playwright-e2e';

for (const viewport of [
  { height: 900, name: 'desktop', width: 1440 },
  { height: 844, name: 'mobile', width: 390 },
]) {
  test(`keeps the approved homepage copy and footer layout on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      height: viewport.height,
      width: viewport.width,
    });
    await page.goto('/');

    await expect(
      page.getByText('CampusLink 是面向西大学子的校园公共空间。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('公开内容经过审核，匿名树洞也为表达保留边界。'),
    ).toHaveCount(0);

    const headerRegion = page.locator('.header-scroll-region');
    await expect(headerRegion).toBeVisible();
    const headerEntries = headerRegion.locator('a');
    await expect(headerEntries).toHaveCount(8);
    const entryTops = await headerEntries.evaluateAll((links) =>
      links.map((link) => Math.round(link.getBoundingClientRect().top)),
    );
    expect(new Set(entryTops).size).toBe(1);

    if (viewport.name === 'mobile') {
      const scrollMetrics = await headerRegion.evaluate((region) => ({
        clientWidth: region.clientWidth,
        scrollWidth: region.scrollWidth,
      }));
      expect(scrollMetrics.scrollWidth).toBeGreaterThan(
        scrollMetrics.clientWidth,
      );

      const publishLink = headerRegion.getByRole('link', {
        exact: true,
        name: '发布内容',
      });
      await headerRegion.evaluate((region) => {
        region.scrollLeft = region.scrollWidth;
      });
      await expect(publishLink).toBeInViewport();

      await headerRegion.evaluate((region) => {
        region.scrollLeft = 0;
      });
      const brandLink = headerRegion.getByRole('link', {
        exact: true,
        name: '西大同学 CampusLink 首页',
      });
      await brandLink.focus();
      await expect(brandLink).toBeFocused();
      await expect(brandLink).toBeInViewport();
      await expect(headerRegion).toHaveJSProperty('scrollLeft', 0);
    }

    const layout = await page.evaluate(() => {
      const footer = document.querySelector('footer');
      const main = document.querySelector('#main-content');
      if (!footer || !main) throw new Error('Shared layout is missing.');
      const footerBox = footer.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      return {
        footerBottom: footerBox.bottom,
        footerTop: footerBox.top,
        mainBottom: mainBox.bottom,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });

    expect(layout.footerBottom).toBeGreaterThanOrEqual(
      layout.viewportHeight - 1,
    );
    expect(layout.footerTop).toBeGreaterThanOrEqual(layout.mainBottom - 1);
    expect(layout.overflow).toBeLessThanOrEqual(1);
  });
}
