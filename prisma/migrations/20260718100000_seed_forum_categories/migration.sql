BEGIN;

WITH defaults("slug", "label") AS (
  VALUES
    ('campus-life', '校园生活'),
    ('study-help', '学习互助'),
    ('lost-and-found', '失物招领'),
    ('interests', '兴趣交流'),
    ('help-and-advice', '求助建议'),
    ('emotional-support', '情感交流'),
    ('other', '其他')
)
INSERT INTO "ForumCategory" (
  "id",
  "campusId",
  "slug",
  "label",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  'forum_category_' || substr(md5(campus."id" || ':' || defaults."slug"), 1, 24),
  campus."id",
  defaults."slug",
  defaults."label",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Campus" AS campus
CROSS JOIN defaults
ON CONFLICT ("campusId", "slug") DO NOTHING;

COMMIT;
