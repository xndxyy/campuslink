import { getDb } from '@/lib/db';
import {
  type ContentAdapter,
  type ContentRecord,
  getPublicContent,
  listPublicContent,
} from '@/lib/domain/content-service';
import { contentListQuerySchema } from '@/lib/validation/content';

export type PublicContentKind = 'resource' | 'marketplace' | 'campus-work';

const publicListFilterKeys = [
  'condition',
  'location',
  'maxPrice',
  'minPrice',
  'search',
  'tag',
] as const;

export type PublicListFilterValues = Partial<
  Record<(typeof publicListFilterKeys)[number], string>
>;

export interface PublicListDependencies {
  adapter?: ContentAdapter;
  list?: typeof listPublicContent;
}

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
  dependencies: PublicListDependencies = {},
) {
  const normalized = Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
      .filter((entry) => entry[1] !== '' && entry[1] !== undefined),
  ) as Record<string, string>;
  const filters = Object.fromEntries(
    publicListFilterKeys.flatMap((key) =>
      normalized[key] === undefined ? [] : [[key, normalized[key]]],
    ),
  ) as PublicListFilterValues;
  const parsed = contentListQuerySchema.safeParse(normalized);

  if (!parsed.success) {
    const priceIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === 'minPrice' || issue.path[0] === 'maxPrice',
    );
    return {
      filterError: priceIssue?.message ?? '筛选条件无效，请修改后重试。',
      filters,
      items: [],
      page: 1,
      pageSize: 12,
      query: {},
      total: 0,
    };
  }

  const adapter =
    dependencies.adapter ?? (getDb() as unknown as ContentAdapter);
  const list = dependencies.list ?? listPublicContent;
  const result = await list(adapter, kind, parsed.data);
  return { ...result, filters, query: parsed.data };
}

export function loadPublicDetail(kind: PublicContentKind, id: string) {
  return getPublicContent(getDb() as unknown as ContentAdapter, kind, id);
}
