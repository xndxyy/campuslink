export type PresetTagDefault = Readonly<{
  label: string;
  scope: 'RESOURCE' | 'MARKETPLACE' | 'CAMPUS_WORK';
  slug: string;
}>;

export const presetTagDefaults: readonly PresetTagDefault[] = [
  { label: '课程笔记', scope: 'RESOURCE', slug: 'course-notes' },
  { label: '课件讲义', scope: 'RESOURCE', slug: 'course-materials' },
  { label: '试题题库', scope: 'RESOURCE', slug: 'exam-bank' },
  { label: '学习工具', scope: 'RESOURCE', slug: 'study-tools' },
  { label: '经验分享', scope: 'RESOURCE', slug: 'experience-sharing' },
  { label: '其他', scope: 'RESOURCE', slug: 'other' },
  { label: '教材书籍', scope: 'MARKETPLACE', slug: 'textbooks' },
  { label: '数码设备', scope: 'MARKETPLACE', slug: 'electronics' },
  { label: '生活用品', scope: 'MARKETPLACE', slug: 'daily-items' },
  { label: '宿舍用品', scope: 'MARKETPLACE', slug: 'dorm-items' },
  { label: '运动户外', scope: 'MARKETPLACE', slug: 'sports-outdoors' },
  { label: '免费赠送', scope: 'MARKETPLACE', slug: 'free' },
  { label: '求购', scope: 'MARKETPLACE', slug: 'wanted' },
  { label: '其他', scope: 'MARKETPLACE', slug: 'other' },
  { label: '校园跑腿', scope: 'CAMPUS_WORK', slug: 'campus-errand' },
  { label: '临时兼职', scope: 'CAMPUS_WORK', slug: 'temporary-job' },
  { label: '家教辅导', scope: 'CAMPUS_WORK', slug: 'tutoring' },
  { label: '活动协助', scope: 'CAMPUS_WORK', slug: 'event-help' },
  { label: '技能服务', scope: 'CAMPUS_WORK', slug: 'skills-service' },
  {
    label: '设计摄影',
    scope: 'CAMPUS_WORK',
    slug: 'design-photography',
  },
  { label: '其他', scope: 'CAMPUS_WORK', slug: 'other' },
];

export type BlockedWordDefault = Readonly<{
  category: string;
  normalized: string;
  original: string;
  reason: string;
}>;

export const blockedWordDefaults: readonly BlockedWordDefault[] = [
  {
    category: '考试诚信',
    normalized: '代考',
    original: '代考',
    reason: '禁止提供或招募代考服务',
  },
  {
    category: '考试诚信',
    normalized: '代写论文',
    original: '代写论文',
    reason: '禁止提供学术作弊服务',
  },
  {
    category: '诈骗引流',
    normalized: '刷单返利',
    original: '刷单返利',
    reason: '常见诈骗引流话术',
  },
  {
    category: '诈骗引流',
    normalized: '先交保证金',
    original: '先交保证金',
    reason: '常见预付款诈骗话术',
  },
  {
    category: '违法内容',
    normalized: '出借银行卡',
    original: '出借银行卡',
    reason: '禁止交易或出借金融账户',
  },
  {
    category: '色情内容',
    normalized: '裸聊',
    original: '裸聊',
    reason: '禁止色情招揽内容',
  },
];
