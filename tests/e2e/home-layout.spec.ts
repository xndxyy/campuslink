import { expect, test } from '@playwright/test';

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
