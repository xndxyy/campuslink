import Link from 'next/link';
import { notFound } from 'next/navigation';

import { UserDetailDrawer } from '@/components/admin/user-detail-drawer';
import { UserFilters } from '@/components/admin/user-filters';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  buildManagedUsersHref,
  getManagedUserDetail,
  listManagedUsers,
  parseManagedUsersQuery,
  type AdministrationAdapter,
  type ManagedUserDetail,
  type ManagedUserDetailTab,
  type ManagedUserListResult,
} from '@/lib/domain/administration';

type UserSearchParams = Record<string, string | string[] | undefined>;

function toUrlSearchParams(input: UserSearchParams) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item);
    } else if (value !== undefined) {
      result.set(key, value);
    }
  }
  return result;
}

const roleLabels: Record<string, string> = {
  ADMIN: '管理员',
  MODERATOR: '版主',
  STUDENT: '普通用户',
};
const statusLabels: Record<string, string> = {
  ACTIVE: '正常',
  PENDING_VERIFICATION: '待验证',
  SUSPENDED: '已停用',
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<UserSearchParams>;
}) {
  let currentUser;
  try {
    currentUser = await requireRole(['ADMIN']);
  } catch {
    notFound();
  }

  const values = toUrlSearchParams(await searchParams);
  let parsed;
  try {
    parsed = parseManagedUsersQuery(values);
  } catch {
    return (
      <section>
        <header className="admin-masthead">
          <p className="eyebrow">仅限管理员</p>
          <h2>用户治理</h2>
        </header>
        <div className="error-state" role="alert">
          筛选条件无效，请清除链接中的异常参数后重试。
        </div>
        <Link href="/admin/users">返回用户列表</Link>
      </section>
    );
  }

  const actor = {
    campusId: currentUser.campusId,
    id: currentUser.id,
    role: currentUser.role,
  };
  let result: ManagedUserListResult | null = null;
  let detail: ManagedUserDetail | null = null;
  let listError = false;
  let detailError = false;
  try {
    result = await listManagedUsers(
      getDb() as unknown as AdministrationAdapter,
      actor,
      parsed.query,
    );
  } catch {
    listError = true;
  }
  if (parsed.userId) {
    try {
      detail = await getManagedUserDetail(
        getDb() as unknown as AdministrationAdapter,
        actor,
        parsed.userId,
      );
    } catch {
      detailError = true;
    }
  }

  const nextHref =
    result?.hasNextPage && result.nextCursor
      ? buildManagedUsersHref(values, {
          cursor: result.nextCursor,
          tab: null,
          user: null,
        })
      : null;
  const closeHref = buildManagedUsersHref(values, { tab: null, user: null });
  const tabHrefs = parsed.userId
    ? (Object.fromEntries(
        (['overview', 'submissions', 'reports', 'audit'] as const).map(
          (tab) => [
            tab,
            buildManagedUsersHref(values, { tab, user: parsed.userId! }),
          ],
        ),
      ) as Record<ManagedUserDetailTab, string>)
    : null;

  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">仅限管理员</p>
        <h2>用户治理</h2>
        <p>在本校范围内筛选账号、查看治理记录并执行有原因的审计操作。</p>
      </header>
      {result ? (
        <dl className="admin-user-counts" aria-label="本校用户概览">
          <div>
            <dt>全部用户</dt>
            <dd>{result.counts.total}</dd>
          </div>
          <div>
            <dt>正常账号</dt>
            <dd>{result.counts.active}</dd>
          </div>
          <div>
            <dt>已停用</dt>
            <dd>{result.counts.suspended}</dd>
          </div>
          <div>
            <dt>未验证</dt>
            <dd>{result.counts.unverified}</dd>
          </div>
          <div>
            <dt>治理人员</dt>
            <dd>{result.counts.staff}</dd>
          </div>
        </dl>
      ) : null}
      <UserFilters values={values} />
      {listError ? (
        <div className="error-state" role="alert">
          用户列表暂时无法加载，请稍后重试。
        </div>
      ) : result?.items.length === 0 ? (
        <div className="empty-state">
          <h2>没有符合当前条件的用户</h2>
          <p>调整搜索词或筛选组合后再试。</p>
        </div>
      ) : (
        <div className="admin-user-list" aria-label="用户列表">
          {result?.items.map((user) => (
            <Link
              className="admin-user-row"
              href={buildManagedUsersHref(values, {
                tab: 'overview',
                user: user.id,
              })}
              key={user.id}
              scroll={false}
            >
              <span className="admin-user-identity">
                <strong>{user.name ?? '未填写姓名'}</strong>
                <small>{user.email}</small>
              </span>
              <span>
                <small>角色</small>
                {roleLabels[user.role]}
              </span>
              <span>
                <small>状态</small>
                {statusLabels[user.status]}
              </span>
              <span>
                <small>验证状态</small>
                {user.emailVerifiedAt ? '已验证' : '未验证'}
              </span>
              <span aria-hidden="true" className="admin-user-row-arrow">
                →
              </span>
            </Link>
          ))}
        </div>
      )}
      {nextHref ? (
        <nav aria-label="用户列表分页" className="admin-user-pagination">
          <Link href={nextHref}>下一页</Link>
        </nav>
      ) : null}
      {detailError ? (
        <div className="error-state" role="alert">
          无法打开该用户详情。目标可能不存在或不属于当前学校。
          <Link href={closeHref} replace>
            关闭详情
          </Link>
        </div>
      ) : null}
      {detail && tabHrefs ? (
        <UserDetailDrawer
          activeTab={parsed.tab}
          closeHref={closeHref}
          detail={detail}
          tabHrefs={tabHrefs}
        />
      ) : null}
    </section>
  );
}
