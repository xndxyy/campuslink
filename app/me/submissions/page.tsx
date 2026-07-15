import Link from 'next/link';
import { OwnerActions } from '@/components/content/owner-actions';
import { requireVerifiedUser } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  type ContentAdapter,
  listOwnedContent,
} from '@/lib/domain/content-service';
import { contentTagsForPresentation } from '@/lib/domain/public-content';
import { type ForumAdapter, listOwnedForumPosts } from '@/lib/domain/forum';
import { loadAnonymousIdentityKeyring } from '@/lib/security/anonymous-identity';

async function loadGroups() {
  try {
    const user = await requireVerifiedUser();
    const adapter = getDb() as unknown as ContentAdapter;
    const actor = { campusId: user.campusId, id: user.id, role: user.role };
    const [resources, marketplace, campusWork, forum] = await Promise.all([
      listOwnedContent(adapter, actor, 'resource'),
      listOwnedContent(adapter, actor, 'marketplace'),
      listOwnedContent(adapter, actor, 'campus-work'),
      listOwnedForumPosts(
        getDb() as unknown as ForumAdapter,
        {
          ...actor,
          emailVerifiedAt: user.emailVerifiedAt,
          status: user.status,
        },
        loadAnonymousIdentityKeyring(),
      ),
    ]);
    return {
      content: [
        ['学习资源', 'resource', resources],
        ['二手物品', 'marketplace', marketplace],
        ['校园工作', 'campus-work', campusWork],
      ] as const,
      forum,
    };
  } catch {
    return null;
  }
}

export default async function MySubmissionsPage() {
  const groups = await loadGroups();
  if (!groups) {
    return (
      <main className="page-shell">
        <section className="empty-state">
          <p className="eyebrow">需要验证身份</p>
          <h1>登录后查看你的提交</h1>
          <Link href="/auth/sign-in">前往登录</Link>
        </section>
      </main>
    );
  }
  return (
    <main className="page-shell">
      <header className="section-masthead">
        <div>
          <p className="eyebrow">个人档案</p>
          <h1>我的提交</h1>
        </div>
        <Link className="primary-link" href="/submit/resource">
          新建提交
        </Link>
      </header>
      {groups.content.map(([label, kind, items]) => (
        <section className="owner-group" key={label}>
          <h2>{label}</h2>
          {items.length === 0 ? (
            <p>暂无记录。</p>
          ) : (
            items.map((item) => (
              <article key={item.id}>
                <strong>{String(item.title)}</strong>
                <span
                  className={`status status-${String(item.status).toLowerCase()}`}
                >
                  {String(item.status)}
                </span>
                {contentTagsForPresentation(item).length > 0 ? (
                  <ul className="content-tag-list" aria-label="内容标签">
                    {contentTagsForPresentation(item).map((tag) => (
                      <li
                        className={tag.isActive ? undefined : 'is-inactive'}
                        key={tag.id}
                        title={tag.isActive ? undefined : '历史标签（已停用）'}
                      >
                        {tag.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.decisionReason ? (
                  <p className="decision-reason">
                    Latest moderator decision ({String(item.decisionAction)}):{' '}
                    {String(item.decisionReason)}
                  </p>
                ) : null}
                <OwnerActions
                  id={item.id}
                  kind={kind}
                  status={String(item.status)}
                />
              </article>
            ))
          )}
        </section>
      ))}
      {(
        [
          ['普通论坛', 'discussion', groups.forum.discussions],
          ['匿名树洞', 'tree-hole', groups.forum.treeHoles],
        ] as const
      ).map(([label, view, items]) => (
        <section className="owner-group" key={view}>
          <h2>{label}</h2>
          {items.length === 0 ? (
            <p>暂无记录。</p>
          ) : (
            items.map((item) => (
              <article key={item.id}>
                <strong>{item.title}</strong>
                <span
                  className={`status status-${String(item.status).toLowerCase()}`}
                >
                  {String(item.status)}
                </span>
                <Link href={`/forum/${item.id}?view=${view}&owner=true`}>
                  查看并管理
                </Link>
              </article>
            ))
          )}
        </section>
      ))}
    </main>
  );
}
