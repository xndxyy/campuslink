import Link from 'next/link';
import { requireVerifiedUser } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  type ContentAdapter,
  listOwnedContent,
} from '@/lib/domain/content-service';

async function loadGroups() {
  try {
    const user = await requireVerifiedUser();
    const adapter = getDb() as unknown as ContentAdapter;
    const actor = { campusId: user.campusId, id: user.id, role: user.role };
    const [resources, marketplace, jobs] = await Promise.all([
      listOwnedContent(adapter, actor, 'resource'),
      listOwnedContent(adapter, actor, 'marketplace'),
      listOwnedContent(adapter, actor, 'job'),
    ]);
    return [
      ['学习资源', resources],
      ['二手物品', marketplace],
      ['校园工作', jobs],
    ] as const;
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
      {groups.map(([label, items]) => (
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
              </article>
            ))
          )}
        </section>
      ))}
    </main>
  );
}
