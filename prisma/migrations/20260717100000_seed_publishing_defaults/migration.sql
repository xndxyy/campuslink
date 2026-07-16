-- Insert defaults once for every campus that is active at deployment time.
WITH defaults(scope, label, slug) AS (
  VALUES
    ('RESOURCE'::"TagScope", '课程笔记', 'course-notes'),
    ('RESOURCE'::"TagScope", '课件讲义', 'course-materials'),
    ('RESOURCE'::"TagScope", '试题题库', 'exam-bank'),
    ('RESOURCE'::"TagScope", '学习工具', 'study-tools'),
    ('RESOURCE'::"TagScope", '经验分享', 'experience-sharing'),
    ('RESOURCE'::"TagScope", '其他', 'other'),
    ('MARKETPLACE'::"TagScope", '教材书籍', 'textbooks'),
    ('MARKETPLACE'::"TagScope", '数码设备', 'electronics'),
    ('MARKETPLACE'::"TagScope", '生活用品', 'daily-items'),
    ('MARKETPLACE'::"TagScope", '宿舍用品', 'dorm-items'),
    ('MARKETPLACE'::"TagScope", '运动户外', 'sports-outdoors'),
    ('MARKETPLACE'::"TagScope", '免费赠送', 'free'),
    ('MARKETPLACE'::"TagScope", '求购', 'wanted'),
    ('MARKETPLACE'::"TagScope", '其他', 'other'),
    ('CAMPUS_WORK'::"TagScope", '校园跑腿', 'campus-errand'),
    ('CAMPUS_WORK'::"TagScope", '临时兼职', 'temporary-job'),
    ('CAMPUS_WORK'::"TagScope", '家教辅导', 'tutoring'),
    ('CAMPUS_WORK'::"TagScope", '活动协助', 'event-help'),
    ('CAMPUS_WORK'::"TagScope", '技能服务', 'skills-service'),
    ('CAMPUS_WORK'::"TagScope", '设计摄影', 'design-photography'),
    ('CAMPUS_WORK'::"TagScope", '其他', 'other')
)
INSERT INTO "TagDefinition" (
  "id", "campusId", "scope", "label", "slug", "isPreset", "isActive", "createdAt"
)
SELECT
  'tag_' || substr(md5(campus."id" || ':' || defaults.scope::text || ':' || defaults.slug), 1, 24),
  campus."id",
  defaults.scope,
  defaults.label,
  defaults.slug,
  true,
  true,
  CURRENT_TIMESTAMP
FROM "Campus" AS campus
CROSS JOIN defaults
WHERE campus."isActive" = true
ON CONFLICT DO NOTHING;

WITH defaults(category, original, normalized, reason) AS (
  VALUES
    ('考试诚信', '代考', '代考', '禁止提供或招募代考服务'),
    ('考试诚信', '代写论文', '代写论文', '禁止提供学术作弊服务'),
    ('诈骗引流', '刷单返利', '刷单返利', '常见诈骗引流话术'),
    ('诈骗引流', '先交保证金', '先交保证金', '常见预付款诈骗话术'),
    ('违法内容', '出借银行卡', '出借银行卡', '禁止交易或出借金融账户'),
    ('色情内容', '裸聊', '裸聊', '禁止色情招揽内容')
)
INSERT INTO "BlockedWord" (
  "id", "campusId", "original", "normalized", "category", "reason", "enabled", "createdAt", "updatedAt"
)
SELECT
  'word_' || substr(md5(campus."id" || ':' || defaults.normalized), 1, 24),
  campus."id",
  defaults.original,
  defaults.normalized,
  defaults.category,
  defaults.reason,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Campus" AS campus
CROSS JOIN defaults
WHERE campus."isActive" = true
ON CONFLICT DO NOTHING;
