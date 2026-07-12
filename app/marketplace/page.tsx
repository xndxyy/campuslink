import { PublicList } from '@/components/content/public-list';
import { loadPublicList } from '@/lib/domain/public-content';

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let result;
  try {
    result = await loadPublicList('marketplace', await searchParams);
  } catch {
    result = {
      error: '市集数据库暂时不可用，请稍后再来。',
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
      kind="marketplace"
      page={result.page}
      pageSize={result.pageSize}
      query={result.query}
      total={result.total}
    />
  );
}
