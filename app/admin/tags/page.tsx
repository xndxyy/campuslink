import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  TagManagement,
  type ManagedTagItem,
} from '@/components/admin/tag-management';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import { listManagedTags, type TagAdapter } from '@/lib/domain/tags';
import type { TagScope } from '@/lib/validation/tags';

function requestedScope(value: string | string[] | undefined): TagScope {
  if (value === undefined) return 'RESOURCE';
  if (
    value === 'RESOURCE' ||
    value === 'MARKETPLACE' ||
    value === 'CAMPUS_WORK'
  ) {
    return value;
  }
  notFound();
}

export default async function TagsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string | string[] }>;
}) {
  let actor;
  try {
    const user = await requireRole(['ADMIN']);
    actor = { campusId: user.campusId, id: user.id, role: user.role };
  } catch {
    notFound();
  }

  const params = await searchParams;
  const scope = requestedScope(params.scope);
  let items: ManagedTagItem[] = [];
  let unavailable = false;
  try {
    items = await listManagedTags(
      getDb() as unknown as TagAdapter,
      actor,
      scope,
    );
  } catch {
    unavailable = true;
  }

  return (
    <section className="tag-admin">
      <header className="admin-masthead">
        <p className="eyebrow">仅管理员可用</p>
        <h2>标签管理</h2>
        <p>维护当前校区的预设与自定义标签，停用后保留历史定义和审计记录。</p>
      </header>

      <nav aria-label="标签范围" className="tag-scope-tabs">
        <Link
          aria-current={scope === 'RESOURCE' ? 'page' : undefined}
          href="/admin/tags?scope=RESOURCE"
        >
          学习资源
        </Link>
        <Link
          aria-current={scope === 'MARKETPLACE' ? 'page' : undefined}
          href="/admin/tags?scope=MARKETPLACE"
        >
          二手交易
        </Link>
        <Link
          aria-current={scope === 'CAMPUS_WORK' ? 'page' : undefined}
          href="/admin/tags?scope=CAMPUS_WORK"
        >
          校园工作
        </Link>
      </nav>

      {unavailable ? (
        <div className="empty-state error-state">
          <h2>标签列表暂时不可用</h2>
          <p>请检查数据库连接后重试。</p>
        </div>
      ) : (
        <TagManagement items={items} scope={scope} />
      )}
    </section>
  );
}
