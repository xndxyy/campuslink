import { describe, expect, it } from 'vitest';
import { mergeRecentContent } from '@/lib/domain/recent-content';

describe('mergeRecentContent', () => {
  it('globally sorts all content by createdAt then id before slicing', () => {
    const at = new Date('2026-07-12T10:00:00Z');
    expect(
      mergeRecentContent(
        [
          [{ id: 'a', title: 'Older resource', createdAt: new Date('2026-07-11'), type: 'resources' as const }],
          [{ id: 'b', title: 'Newest market', createdAt: new Date('2026-07-13'), type: 'marketplace' as const }],
          [
            { id: 'c', title: 'Same time lower id', createdAt: at, type: 'jobs' as const },
            { id: 'd', title: 'Same time higher id', createdAt: at, type: 'jobs' as const },
          ],
        ],
        3,
      ).map((item) => item.id),
    ).toEqual(['b', 'd', 'c']);
  });
});
