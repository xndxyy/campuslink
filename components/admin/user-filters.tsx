import Link from 'next/link';

export function UserFilters({ values }: { values: URLSearchParams }) {
  return (
    <form className="admin-filter admin-user-filter" method="get">
      <label className="admin-user-search">
        搜索姓名或邮箱
        <input
          defaultValue={values.get('search') ?? ''}
          maxLength={200}
          name="search"
          placeholder="输入姓名或邮箱"
          type="search"
        />
      </label>
      <label>
        角色
        <select defaultValue={values.get('role') ?? ''} name="role">
          <option value="">全部角色</option>
          <option value="STUDENT">普通用户</option>
          <option value="MODERATOR">版主</option>
          <option value="ADMIN">管理员</option>
        </select>
      </label>
      <label>
        状态
        <select defaultValue={values.get('status') ?? ''} name="status">
          <option value="">全部状态</option>
          <option value="PENDING_VERIFICATION">待验证</option>
          <option value="ACTIVE">正常</option>
          <option value="SUSPENDED">已停用</option>
        </select>
      </label>
      <label>
        验证状态
        <select defaultValue={values.get('verified') ?? ''} name="verified">
          <option value="">全部</option>
          <option value="true">已验证</option>
          <option value="false">未验证</option>
        </select>
      </label>
      <label>
        每页数量
        <select defaultValue={values.get('pageSize') ?? '25'} name="pageSize">
          <option value="10">10</option>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </label>
      <input disabled name="cursor" type="hidden" value="" />
      <div className="admin-filter-actions">
        <button type="submit">应用筛选</button>
        <Link href="/admin/users">清除</Link>
      </div>
    </form>
  );
}
