import { describe, expect, it } from 'vitest';

import { campusWorkPresetTags } from '@/prisma/seed-data';

describe('campus-work preset seed data', () => {
  it('contains exactly the five approved fully specified presets', () => {
    expect(campusWorkPresetTags).toHaveLength(5);
    expect(campusWorkPresetTags).toStrictEqual([
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
    ]);
  });

  it('uses one unique stable slug per preset', () => {
    const slugs = campusWorkPresetTags.map((preset) => preset.slug);

    expect(new Set(slugs).size).toBe(5);
  });
});
