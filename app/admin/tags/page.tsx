import Link from 'next/link';
import { notFound } from 'next/navigation';

import { TagManagement } from '@/components/admin/tag-management';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listManagedTags,
  parseManagedTagQuery,
  type ManagedTagPage,
  type TagAdapter,
} from '@/lib/domain/tags';
import type { TagScope } from '@/lib/validation/tags';

type TagPageSearchParams = Record<string, string | string[] | undefined> & {
  cursor?: string | string[];
  pageSize?: string | string[];
  scope?: string | string[];
};

function appendQueryValue(
  search: URLSearchParams,
  key: string,
  value: string | string[] | undefined,
) {
  if (Array.isArray(value)) {
    for (const item of value) search.append(key, item);
  } else if (value !== undefined) {
    search.append(key, value);
  }
}

function pageQuery(params: TagPageSearchParams) {
  const search = new URLSearchParams();
  appendQueryValue(search, 'scope', params.scope ?? 'RESOURCE');
  appendQueryValue(search, 'pageSize', params.pageSize);
  appendQueryValue(search, 'cursor', params.cursor);
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'scope' && key !== 'pageSize' && key !== 'cursor') {
      appendQueryValue(search, key, value);
    }
  }
  return parseManagedTagQuery(search);
}

function scopeHref(scope: TagScope, pageSize: number) {
  return `/admin/tags?scope=${scope}&pageSize=${pageSize}`;
}

export default async function TagsAdminPage({
  searchParams,
}: {
  searchParams: Promise<TagPageSearchParams>;
}) {
  let actor;
  try {
    const user = await requireRole(['ADMIN']);
    actor = { campusId: user.campusId, id: user.id, role: user.role };
  } catch {
    notFound();
  }

  const params = await searchParams;
  let parsed;
  try {
    parsed = pageQuery(params);
  } catch {
    notFound();
  }
  const { query, scope } = parsed;
  const pageSize = query.pageSize ?? 50;
  let page: ManagedTagPage = {
    hasNextPage: false,
    items: [],
    nextCursor: null,
  };
  let unavailable = false;
  try {
    page = await listManagedTags(
      getDb() as unknown as TagAdapter,
      actor,
      scope,
      query,
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
          href={scopeHref('RESOURCE', pageSize)}
        >
          学习资源
        </Link>
        <Link
          aria-current={scope === 'MARKETPLACE' ? 'page' : undefined}
          href={scopeHref('MARKETPLACE', pageSize)}
        >
          二手交易
        </Link>
        <Link
          aria-current={scope === 'CAMPUS_WORK' ? 'page' : undefined}
          href={scopeHref('CAMPUS_WORK', pageSize)}
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
        <>
          <TagManagement items={page.items} scope={scope} />
          {page.hasNextPage && page.nextCursor ? (
            <nav aria-label="标签分页" className="tag-pagination">
              <Link
                href={`/admin/tags?scope=${scope}&pageSize=${pageSize}&cursor=${encodeURIComponent(page.nextCursor)}`}
              >
                下一页
              </Link>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
