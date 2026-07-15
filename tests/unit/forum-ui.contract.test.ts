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

  it('renders every forum status through one Chinese mapping with a safe fallback', () => {
    const labels = source('components/forum/forum-status.ts');
    const detail = source('app/forum/[id]/page.tsx');
    const actions = source('components/forum/forum-actions.tsx');
    const submissions = source('app/me/submissions/page.tsx');
    for (const label of [
      '草稿',
      '待审核',
      '已发布',
      '未通过',
      '已隐藏',
      '已归档',
      '未知状态',
    ]) {
      expect(labels).toContain(label);
    }
    for (const consumer of [detail, actions, submissions]) {
      expect(consumer).toContain('forumStatusLabel');
    }
    expect(detail).not.toContain('${post.status}');
    expect(actions).not.toContain('{status}。');
    expect(submissions).not.toMatch(/>\s*\{String\(item\.status\)\}\s*</);
  });

  it('runs layout checks for either an explicit harness or complete live E2E', () => {
    const layout = source('tests/e2e/forum-layout.spec.ts');
    expect(layout).toContain('shouldRunSharedAccountE2e');
    expect(layout).toContain('FORUM_LAYOUT_URL');
    expect(layout).toMatch(/!layoutUrl\s*&&\s*!runLiveE2e/);
    expect(layout).toContain("layoutUrl || '/forum'");
  });

  it('exercises tree-hole comment rejection through same-origin requests', () => {
    const treeHoleE2e = source('tests/e2e/tree-hole.spec.ts');
    expect(treeHoleE2e).toContain('new URL(page.url()).origin');
    expect(treeHoleE2e.match(/headers: \{ Origin: origin \}/g)).toHaveLength(2);
  });

  it('keeps integration coverage aligned with tree-hole comment privacy', () => {
    const integration = source('tests/integration/forum.test.ts');
    const treeComment = integration.slice(
      integration.indexOf('Tree-hole comments must remain disabled.'),
      integration.indexOf('Tree-hole comments must remain disabled.') + 220,
    );
    expect(treeComment).toContain('ForumNotFoundError');
    expect(treeComment).not.toContain('ForumConflictError');
  });

  it('hydrates likes and paginated discussion comments from viewer-safe server state', () => {
    const detail = source('app/forum/[id]/page.tsx');
    const actions = source('components/forum/forum-actions.tsx');
    const comments = source('components/forum/comment-list.tsx');
    expect(detail).toContain('commentPage');
    expect(detail).toContain('pageSize: 20');
    expect(detail).toContain('forumLike.findUnique');
    expect(detail).toContain('initialLiked');
    expect(actions).toContain('initialLiked');
    expect(actions).toContain('useState(initialLiked)');
    expect(comments).toContain('total} 条');
    expect(comments).toContain('commentPageHref');
    expect(comments).toContain('lastCommentPage');
  });

  it('resets comment forms only after success and validates delete outcomes', () => {
    const comments = source('components/forum/comment-list.tsx');
    const actions = source('components/forum/forum-actions.tsx');
    expect(comments).toContain('return true');
    expect(comments).toContain('return false');
    expect(comments).toMatch(
      /if \(await mutate\('POST',[\s\S]*?form\.reset\(\)/,
    );
    expect(comments).not.toMatch(/mutate\('POST'[\s\S]{0,120}\.then/);
    expect(actions).toContain('parseForumDeleteResult');
    expect(actions).toContain("outcome.kind === 'archived'");
  });

  it('hides owner reports and provides keyboard-safe modal focus management', () => {
    const actions = source('components/forum/forum-actions.tsx');
    expect(actions).toContain('reportTriggerRef');
    expect(actions).toContain('reportInitialFocusRef');
    expect(actions).toContain("event.key === 'Escape'");
    expect(actions).toContain("event.key !== 'Tab'");
    expect(actions).toContain('reportTriggerRef.current?.focus()');
    expect(actions).toMatch(/!owner[\s\S]{0,180}setReportOpen\(true\)/);
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
