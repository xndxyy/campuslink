import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string) {
  const sourcePath = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : '';
}

const publishTypeSource = readSource(
  '../../components/content/publish-type-list.tsx',
);
const publishPageSource = readSource('../../app/submit/page.tsx');
const categoryStripSource = readSource(
  '../../components/home/category-strip.tsx',
);

const source = readFileSync(
  fileURLToPath(
    new URL('../../components/content/submission-form.tsx', import.meta.url),
  ),
  'utf8',
);

describe('submission form async event safety', () => {
  it('captures the form before awaiting and resets the captured element', () => {
    const capture = source.indexOf('const form = event.currentTarget;');
    const firstAwait = source.indexOf(
      'await ',
      source.indexOf('async function submit'),
    );
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(firstAwait);
    expect(source).toContain('new FormData(form)');
    expect(source).toContain('form.reset()');
    expect(source).not.toContain('event.currentTarget.reset()');
  });
});

describe('unified publish navigation contract', () => {
  it('defines exactly the five approved publish destinations in one typed constant', () => {
    expect(publishTypeSource).toContain('export const publishTypes');
    expect(publishTypeSource).toContain('as const');

    const entries = [
      ...publishTypeSource.matchAll(
        /href:\s*'([^']+)'[\s\S]{0,80}?label:\s*'([^']+)'/g,
      ),
    ].map((match) => [match[1], match[2]]);

    expect(entries).toEqual([
      ['/submit/resource', '学习资源'],
      ['/submit/marketplace', '二手交易'],
      ['/submit/campus-work', '校园工作'],
      ['/submit/forum', '论坛帖子'],
      ['/submit/tree-hole', '匿名树洞'],
    ]);
  });

  it('renders the publish choices from the shared list component', () => {
    expect(publishTypeSource).toContain('export function PublishTypeList');
    expect(publishTypeSource).toContain('publishTypes.map');
    expect(publishPageSource).toContain('import { PublishTypeList }');
    expect(publishPageSource).toContain('<PublishTypeList />');
  });

  it('defines the exact four-section home navigation strip', () => {
    const entries = [
      ...categoryStripSource.matchAll(
        /href:\s*'([^']+)'[\s\S]{0,80}?label:\s*'([^']+)'/g,
      ),
    ].map((match) => [match[1], match[2]]);

    expect(entries).toEqual([
      ['/resources', '学习资源'],
      ['/marketplace', '二手交易'],
      ['/campus-work', '校园工作'],
      ['/forum', '校园论坛'],
    ]);
    expect(categoryStripSource).toContain(
      "summary: '预设标签与自定义标签表达具体类型'",
    );
    expect(categoryStripSource).toContain('export function CategoryStrip');
  });
});
