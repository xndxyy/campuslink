import { getDb } from '@/lib/db';
import {
  type ContentAdapter,
  type ContentRecord,
  getPublicContent,
  listPublicContent,
} from '@/lib/domain/content-service';
import { contentListQuerySchema } from '@/lib/validation/content';

export type PublicContentKind = 'resource' | 'marketplace' | 'job';

export interface PresentedContentTag {
  id: string;
  isActive: boolean;
  isPreset: boolean;
  label: string;
}

export function contentTagsForPresentation(
  item: ContentRecord,
): PresentedContentTag[] {
  if (!Array.isArray(item.tags)) return [];
  return item.tags.filter((tag): tag is PresentedContentTag => {
    if (!tag || typeof tag !== 'object') return false;
    const candidate = tag as Partial<PresentedContentTag>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.label === 'string' &&
      typeof candidate.isActive === 'boolean' &&
      typeof candidate.isPreset === 'boolean'
    );
  });
}

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
