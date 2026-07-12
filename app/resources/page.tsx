import { PublicList } from '@/components/content/public-list';
import { loadPublicList } from '@/lib/domain/public-content';

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let result;
  try {
    result = await loadPublicList('resource', await searchParams);
  } catch {
    result = {
      error: '资源数据库暂时不可用，请稍后再来。',
      items: [],
      page: 1,
      pageSize: 12,
      query: {},
      total: 0,
    };
  }
  return (
    <PublicList
      error={'error' in result ? result.error : undefined}
      items={result.items}
      kind="resource"
      page={result.page}
      pageSize={result.pageSize}
      query={result.query}
      total={result.total}
    />
  );
}
