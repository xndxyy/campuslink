import { PublicList } from '@/components/content/public-list';
import { loadPublicList } from '@/lib/domain/public-content';

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let result;
  try {
    result = await loadPublicList('job', await searchParams);
  } catch {
    result = {
      error: '招聘数据库暂时不可用，请稍后再来。',
      items: [],
      page: 1,
      total: 0,
    };
  }
  return (
    <PublicList
      error={'error' in result ? result.error : undefined}
      items={result.items}
      kind="job"
      page={result.page}
      total={result.total}
    />
  );
}
