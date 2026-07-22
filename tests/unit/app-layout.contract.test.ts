import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SiteBrand } from '@/components/brand/site-brand';

const layout = readFileSync(
  fileURLToPath(new URL('../../app/layout.tsx', import.meta.url)),
  'utf8',
);
const home = readFileSync(
  fileURLToPath(new URL('../../app/page.tsx', import.meta.url)),
  'utf8',
);
const globalStyles = readFileSync(
  fileURLToPath(new URL('../../app/globals.css', import.meta.url)),
  'utf8',
);
const focusRule =
  globalStyles.match(
    /a:focus-visible,[\s\S]*?select:focus-visible\s*\{[\s\S]*?\}/,
  )?.[0] ?? '';
const mobileHeaderStyles = globalStyles.slice(
  globalStyles.indexOf('@media (max-width: 900px)'),
  globalStyles.indexOf('@media (max-width: 760px)'),
);
const siteBrandPath = fileURLToPath(
  new URL('../../components/brand/site-brand.tsx', import.meta.url),
);
const siteBrand = existsSync(siteBrandPath)
  ? readFileSync(siteBrandPath, 'utf8')
  : '';
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const brandAssets = [
  'campuslink-mark-light.png',
  'campuslink-mark-dark.png',
  'campuslink-icon.png',
] as const;

describe('application layout contract', () => {
  it('declares the smooth scroll behavior used during route transitions', () => {
    expect(layout).toContain('data-scroll-behavior="smooth"');
  });

  it('keeps keyboard focus visible on both light and dark surfaces', () => {
    for (const selector of [
      'a:focus-visible',
      'button:focus-visible',
      'input:focus-visible',
      'textarea:focus-visible',
      'select:focus-visible',
    ]) {
      expect(focusRule).toContain(selector);
    }
    expect(focusRule).toContain('outline: 2px solid #ffffff;');
    expect(focusRule).toContain('outline-offset: 2px;');
    expect(focusRule).toContain('box-shadow: 0 0 0 5px #087a35;');
  });

  it('installs the approved book-ridge identity in the shared shell', () => {
    expect(layout).toContain('import { SiteBrand }');
    expect(layout).toContain('<SiteBrand />');
    expect(siteBrand).toContain('西大同学 CampusLink');
    expect(siteBrand).toContain('/brand/campuslink-mark-light.png');
    expect(layout).toContain('非西南大学官方平台');
  });

  it('registers the existing brand icon through Next metadata', () => {
    expect(layout).toContain("icons: { icon: '/brand/campuslink-icon.png' }");
    expect(
      existsSync(
        fileURLToPath(
          new URL('../../public/brand/campuslink-icon.png', import.meta.url),
        ),
      ),
    ).toBe(true);
  });

  it('renders the brand as an accessible home link', () => {
    const markup = renderToStaticMarkup(createElement(SiteBrand));

    expect(markup).toContain('href="/"');
    expect(markup).toContain('aria-label="西大同学 CampusLink 首页"');
    expect(markup).toContain('西大同学 CampusLink');
  });

  it('uses the unified publish center from the shared header', () => {
    expect(layout).toContain('href="/submit"');
    expect(layout).not.toContain(
      'className="header-action" href="/submit/resource"',
    );
  });

  it('renders the approved single-row shared header in source order', () => {
    const entries = [
      '<SiteBrand />',
      'href="/resources"',
      'href="/marketplace"',
      'href="/campus-work"',
      'href="/forum"',
      'href="/me/submissions"',
      'href="/me/favourites"',
      'className="header-action" href="/submit"',
    ];
    let previousIndex = -1;
    for (const entry of entries) {
      const currentIndex = layout.indexOf(entry);
      expect(currentIndex, `missing ${entry}`).toBeGreaterThan(-1);
      expect(currentIndex, `${entry} is out of order`).toBeGreaterThan(
        previousIndex,
      );
      previousIndex = currentIndex;
    }

    expect(layout).toContain('className="header-scroll-region"');
    expect(layout).toContain('aria-label="全站导航"');
    expect(layout).not.toContain('header-brand-row');
    expect(layout).not.toContain('header-navigation-row');
    expect(globalStyles).toMatch(
      /\.site-header\s*\{[^}]*border-top:\s*18px solid #171717;/,
    );
    expect(globalStyles).toMatch(
      /\.header-scroll-region\s*\{[\s\S]*?overflow-x:\s*auto;/,
    );
    expect(globalStyles).toMatch(
      /\.header-navigation\s*\{[\s\S]*?width:\s*max-content;[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*nowrap;/,
    );
    expect(globalStyles).toMatch(
      /\.site-navigation\s+a\s*\{[\s\S]*?white-space:\s*nowrap;[\s\S]*?flex:\s*0 0 auto;/,
    );
  });

  it('keeps a stable desktop gutter and restores muted utility navigation', () => {
    expect(globalStyles).toMatch(
      /\.header-scroll-region\s*\{[\s\S]*?padding-inline:\s*1\.5rem;[\s\S]*?box-sizing:\s*border-box;/,
    );
    expect(globalStyles).toMatch(
      /\.header-scroll-region\s*\{[^}]*scroll-padding-inline:\s*1\.5rem;/,
    );
    expect(globalStyles).toMatch(
      /\.header-navigation\s*\{[\s\S]*?min-width:\s*min\(1180px,\s*100%\);/,
    );
    expect(mobileHeaderStyles).toMatch(
      /\.header-scroll-region\s*\{[\s\S]*?padding-inline:\s*0;/,
    );
    expect(mobileHeaderStyles).toMatch(
      /\.header-scroll-region\s*\{[^}]*scroll-padding-inline:\s*0\.75rem;/,
    );
    for (const href of ['/me/submissions', '/me/favourites']) {
      expect(layout).toMatch(
        new RegExp(`className="utility-navigation-link"\\s+href="${href}"`),
      );
    }
    expect(globalStyles).toMatch(
      /\.utility-navigation-link\s*\{[\s\S]*?color:\s*var\(--muted\);/,
    );
    expect(globalStyles).not.toMatch(
      /\.utility-navigation-link\s*\{[\s\S]*?color:\s*var\(--muted\)\s*!important;/,
    );
  });

  it('preserves publish action contrast when navigation links are hovered', () => {
    expect(globalStyles).toMatch(
      /\.site-navigation\s+\.header-action:hover\s*\{[\s\S]*?color:\s*var\(--navy\);/,
    );
  });

  it('exposes the four approved first-level product sections', () => {
    for (const [href, label] of [
      ['/resources', '学习资源'],
      ['/marketplace', '二手交易'],
      ['/campus-work', '校园工作'],
      ['/forum', '校园论坛'],
    ]) {
      expect(layout).toContain(`href="${href}"`);
      expect(layout).toContain(`>${label}</Link>`);
    }
    expect(layout).not.toContain('href="/jobs"');
  });

  it('keeps all navigation links in one scrollable mobile row', () => {
    expect(layout).toMatch(
      /className="utility-navigation-link"\s+href="\/me\/submissions"\s*>/,
    );
    expect(layout).toMatch(
      /className="utility-navigation-link"\s+href="\/me\/favourites"\s*>/,
    );
    expect(siteBrand).toContain('site-brand-label-full');
    expect(siteBrand).toContain('site-brand-label-compact');
  });

  it('loads the home announcement at request time and keeps the old recent-content area removed', () => {
    expect(home).toContain('<CategoryStrip />');
    expect(home).toContain("export const dynamic = 'force-dynamic'");
    expect(home).toContain('getHomeAnnouncement');
    expect(home).toContain('catch');
    for (const retiredSource of [
      'mergeRecentContent',
      'recentContent',
      'recent-section',
      '刚刚贴上公告板',
    ]) {
      expect(home).not.toContain(retiredSource);
    }
  });

  it('keeps only the approved homepage description and anchors short-page footers', () => {
    expect(home).toContain('CampusLink 是面向西大学子的校园公共空间。');
    expect(home).not.toContain('公开内容经过审核，匿名树洞也为表达保留边界。');
    expect(globalStyles).toMatch(
      /body\s*\{[\s\S]*?min-height:\s*100vh;[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
    );
    expect(globalStyles).toMatch(/#main-content\s*\{[\s\S]*?flex:\s*1 0 auto;/);
  });

  it.each(brandAssets)('%s is a non-empty PNG asset', (fileName) => {
    const assetPath = fileURLToPath(
      new URL(`../../public/brand/${fileName}`, import.meta.url),
    );

    expect(existsSync(assetPath)).toBe(true);
    const bytes = readFileSync(assetPath);
    expect(bytes.length).toBeGreaterThan(pngSignature.length);
    expect([...bytes.subarray(0, pngSignature.length)]).toEqual(pngSignature);
  });
});
