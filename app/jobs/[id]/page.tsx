import { permanentRedirect } from 'next/navigation';

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) query.append(key, item);
    }
  }
  const destination = `/campus-work/${id}`;
  permanentRedirect(
    query.size > 0 ? `${destination}?${query.toString()}` : destination,
  );
}
