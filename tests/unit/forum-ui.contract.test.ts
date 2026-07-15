import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const requiredFiles = [
  'app/forum/page.tsx',
  'app/forum/[id]/page.tsx',
  'app/submit/forum/page.tsx',
  'app/submit/tree-hole/page.tsx',
  'components/forum/forum-tabs.tsx',
  'components/forum/forum-list.tsx',
  'components/forum/forum-post-form.tsx',
  'components/forum/comment-list.tsx',
  'components/forum/forum-actions.tsx',
] as const;

function source(path: string) {
  return readFileSync(path, 'utf8');
}

describe('forum UI contract', () => {
  it('ships every forum route and component', () => {
    for (const path of requiredFiles) expect(existsSync(path), path).toBe(true);
  });

  it('keeps list URLs stable and preserves filters across tabs, forms, and pagination', () => {
    const tabs = source('components/forum/forum-tabs.tsx');
    const list = source('components/forum/forum-list.tsx');
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain('role="tab"');
    expect(tabs).toContain('URLSearchParams');
    expect(list).toContain('name="view"');
    expect(list).toContain('name="category"');
    expect(list).toContain('name="query"');
    expect(list).toContain('buildForumHref');
  });

  it('authenticates tree-hole pages before domain reads and never renders comments there', () => {
    const listPage = source('app/forum/page.tsx');
    const detailPage = source('app/forum/[id]/page.tsx');
    expect(listPage.indexOf('requireVerifiedPageUser')).toBeLessThan(
      listPage.indexOf('listForumPosts'),
    );
    expect(detailPage).toContain("view === 'tree-hole'");
    expect(detailPage).toContain("view === 'discussion'");
    expect(detailPage).toMatch(
      /view === 'discussion' && post\.status === 'PUBLISHED' \? \([\s\S]*?<CommentList/,
    );
    expect(detailPage).not.toContain('anonymousCiphertext');
    expect(detailPage).not.toContain('anonymousFingerprint');
    expect(detailPage).not.toContain('anonymousKeyVersion');
  });

  it('uses strict same-origin forum API methods with stable Chinese interaction feedback', () => {
    const form = source('components/forum/forum-post-form.tsx');
    const comments = source('components/forum/comment-list.tsx');
    const actions = source('components/forum/forum-actions.tsx');
    expect(form).toContain("method: initialPost ? 'PATCH' : 'POST'");
    expect(form).toContain("'/api/forum/posts'");
    expect(form).toContain("kind === 'TREE_HOLE'");
    expect(comments).toContain("mutate('POST'");
    expect(comments).toContain("mutate('PATCH'");
    expect(comments).toContain("mutate('DELETE'");
    expect(actions).toContain('/likes');
    expect(actions).toContain("'/api/reports'");
    expect(actions).toContain("targetType: 'FORUM_POST'");
    expect(`${form}${comments}${actions}`).toMatch(/发布中|保存中|提交中/);
    expect(`${form}${comments}${actions}`).toContain('aria-live="polite"');
  });

  it('keeps the publishing center at exactly five Chinese entries', () => {
    const publish = source('components/content/publish-type-list.tsx');
    expect(publish.match(/href: '\/submit\//g)).toHaveLength(5);
    for (const label of [
      '学习资源',
      '二手交易',
      '校园工作',
      '普通论坛',
      '匿名树洞',
    ]) {
      expect(publish).toContain(label);
    }
    expect(publish).not.toContain('courseCode');
  });

  it('lists both forum kinds in personal submissions without selecting tree secrets', () => {
    const page = source('app/me/submissions/page.tsx');
    expect(page).toContain('listOwnedForumPosts');
    expect(page).toContain('普通论坛');
    expect(page).toContain('匿名树洞');
    expect(page).not.toContain('anonymousCiphertext');
    expect(page).not.toContain('anonymousKeyVersion');
  });

  it('adds dense responsive forum styling without horizontal overflow hazards', () => {
    const css = source('app/globals.css');
    expect(css).toContain('.forum-shell');
    expect(css).toContain('.forum-list-row');
    expect(css).toContain('.forum-actions');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toMatch(
      /\.forum[^\n{]*\{[\s\S]*?border-radius:\s*(?:9|[1-9]\d)px/,
    );
  });
});
