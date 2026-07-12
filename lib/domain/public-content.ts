import { getDb } from '@/lib/db';
import {
  type ContentAdapter,
  getPublicContent,
  listPublicContent,
} from '@/lib/domain/content-service';
import { contentListQuerySchema } from '@/lib/validation/content';

export type PublicContentKind = 'resource' | 'marketplace' | 'job';

export async function loadPublicList(
  kind: PublicContentKind,
  raw: Record<string, string | string[] | undefined>,
) {
  const normalized = Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
      .filter((entry) => entry[1] !== '' && entry[1] !== undefined),
  );
  const query = contentListQuerySchema.parse(normalized);
  const result = await listPublicContent(
    getDb() as unknown as ContentAdapter,
    kind,
    query,
  );
  return { ...result, query };
}

export function loadPublicDetail(kind: PublicContentKind, id: string) {
  return getPublicContent(getDb() as unknown as ContentAdapter, kind, id);
}
