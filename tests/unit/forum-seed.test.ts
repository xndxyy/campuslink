import { describe, expect, it } from 'vitest';

import * as seedData from '@/prisma/seed-data';

type CategoryRow = {
  campusId: string;
  isActive: boolean;
  label: string;
  slug: string;
};

type UpsertArgs = {
  create: CategoryRow;
  update: Partial<CategoryRow>;
  where: { campusId_slug: { campusId: string; slug: string } };
};

type SeedForumCategories = (
  adapter: {
    forumCategory: {
      upsert(args: UpsertArgs): Promise<unknown>;
    };
  },
  campusId: string,
) => Promise<void>;

describe('forum category seed helper', () => {
  it('creates missing defaults without overwriting administrator governance', async () => {
    const seedForumCategories = (
      seedData as unknown as { seedForumCategories?: SeedForumCategories }
    ).seedForumCategories;
    expect(seedForumCategories).toBeTypeOf('function');
    if (!seedForumCategories) return;

    const rows = new Map<string, CategoryRow>([
      [
        'campus_1:campus-life',
        {
          campusId: 'campus_1',
          isActive: false,
          label: '管理员重命名',
          slug: 'campus-life',
        },
      ],
    ]);
    const calls: UpsertArgs[] = [];
    await seedForumCategories(
      {
        forumCategory: {
          async upsert(args) {
            calls.push(args);
            const key = `${args.where.campusId_slug.campusId}:${args.where.campusId_slug.slug}`;
            const existing = rows.get(key);
            rows.set(
              key,
              existing ? { ...existing, ...args.update } : args.create,
            );
          },
        },
      },
      'campus_1',
    );

    expect(rows.get('campus_1:campus-life')).toStrictEqual({
      campusId: 'campus_1',
      isActive: false,
      label: '管理员重命名',
      slug: 'campus-life',
    });
    expect([...rows.values()]).toHaveLength(5);
    expect(rows.get('campus_1:study-help')).toStrictEqual({
      campusId: 'campus_1',
      isActive: true,
      label: '学习互助',
      slug: 'study-help',
    });
    expect(calls).toHaveLength(5);
    expect(calls.every((call) => Object.keys(call.update).length === 0)).toBe(
      true,
    );
  });
});
