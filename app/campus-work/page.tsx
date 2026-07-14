import { PublicList } from '@/components/content/public-list';
import { loadPublicList } from '@/lib/domain/public-content';

export default async function CampusWorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let result;
  try {
    result = await loadPublicList('campus-work', await searchParams);
  } catch {
    result = {
      error: '校园工作暂时无法加载，请稍后再来。',
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
      kind="campus-work"
      page={result.page}
      pageSize={result.pageSize}
      query={result.query}
      total={result.total}
    />
  );
}
