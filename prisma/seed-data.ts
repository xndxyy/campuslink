export type CampusWorkPresetTag = {
  readonly isActive: true;
  readonly isPreset: true;
  readonly label: string;
  readonly scope: 'CAMPUS_WORK';
  readonly slug: string;
};

export const campusWorkPresetTags: readonly CampusWorkPresetTag[] = [
  {
    isActive: true,
    isPreset: true,
    label: 'COS委托',
    scope: 'CAMPUS_WORK',
    slug: 'cos-commission',
  },
  {
    isActive: true,
    isPreset: true,
    label: '校园跑腿',
    scope: 'CAMPUS_WORK',
    slug: 'campus-errand',
  },
  {
    isActive: true,
    isPreset: true,
    label: '临时兼职',
    scope: 'CAMPUS_WORK',
    slug: 'temporary-job',
  },
  {
    isActive: true,
    isPreset: true,
    label: '技能服务',
    scope: 'CAMPUS_WORK',
    slug: 'skills-service',
  },
  {
    isActive: true,
    isPreset: true,
    label: '其他',
    scope: 'CAMPUS_WORK',
    slug: 'other',
  },
];

export type ForumCategorySeed = {
  readonly isActive: true;
  readonly label: string;
  readonly slug: string;
};

export const forumCategorySeeds: readonly ForumCategorySeed[] = [
  { isActive: true, label: '校园生活', slug: 'campus-life' },
  { isActive: true, label: '学习互助', slug: 'study-help' },
  { isActive: true, label: '失物招领', slug: 'lost-and-found' },
  { isActive: true, label: '兴趣交流', slug: 'interests' },
  { isActive: true, label: '求助建议', slug: 'help-and-advice' },
  { isActive: true, label: '情感交流', slug: 'emotional-support' },
  { isActive: true, label: '其他', slug: 'other' },
];

export interface ForumCategorySeedAdapter {
  forumCategory: {
    upsert(args: {
      create: {
        campusId: string;
        isActive: boolean;
        label: string;
        slug: string;
      };
      update: Record<string, never>;
      where: {
        campusId_slug: { campusId: string; slug: string };
      };
    }): Promise<unknown>;
  };
}

export async function seedForumCategories(
  adapter: ForumCategorySeedAdapter,
  campusId: string,
) {
  for (const category of forumCategorySeeds) {
    await adapter.forumCategory.upsert({
      where: {
        campusId_slug: { campusId, slug: category.slug },
      },
      update: {},
      create: {
        campusId,
        isActive: category.isActive,
        label: category.label,
        slug: category.slug,
      },
    });
  }
}
