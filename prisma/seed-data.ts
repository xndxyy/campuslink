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
