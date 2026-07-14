import { permanentRedirect } from 'next/navigation';

function withSearchParams(
  path: string,
  searchParams: Record<string, string | string[] | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) query.append(key, item);
    }
  }
  const serialized = query.toString();
  return serialized ? `${path}?${serialized}` : path;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  permanentRedirect(withSearchParams('/campus-work', await searchParams));
}
