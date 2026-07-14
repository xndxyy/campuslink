import { permanentRedirect } from 'next/navigation';

export default async function SubmitJobPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) query.append(key, item);
    }
  }
  const destination = '/submit/campus-work';
  permanentRedirect(
    query.size > 0 ? `${destination}?${query.toString()}` : destination,
  );
}
