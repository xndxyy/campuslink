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

  it('keeps the home shell static and removes the old recent-content area', () => {
    expect(home).toContain('<CategoryStrip />');
    for (const retiredSource of [
      'getDb',
      'mergeRecentContent',
      "dynamic = 'force-dynamic'",
      'recentContent',
      'recent-section',
      '刚刚贴上公告板',
    ]) {
      expect(home).not.toContain(retiredSource);
    }
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
