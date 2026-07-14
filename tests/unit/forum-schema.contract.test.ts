import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function readSource(relativePath: string) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const schema = readSource('../../prisma/schema.prisma');
const migration = readSource(
  '../../prisma/migrations/20260713200000_add_forum/migration.sql',
);
const seed = readSource('../../prisma/seed.ts');

function block(kind: 'enum' | 'model', name: string) {
  return (
    schema.match(new RegExp(`${kind} ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ??
    ''
  );
}

describe('forum persistence schema contract', () => {
  it('defines the forum kinds and campus-scoped persistent categories', () => {
    expect(block('enum', 'ForumPostKind')).toMatch(/\bDISCUSSION\b/);
    expect(block('enum', 'ForumPostKind')).toMatch(/\bTREE_HOLE\b/);

    const category = block('model', 'ForumCategory');
    expect(category).toMatch(/campusId\s+String/);
    expect(category).toMatch(/slug\s+String\s+@db\.VarChar\(64\)/);
    expect(category).toMatch(/label\s+String\s+@db\.VarChar\(100\)/);
    expect(category).toMatch(/isActive\s+Boolean\s+@default\(true\)/);
    expect(category).toMatch(/@@unique\(\[campusId, slug\]\)/);
    expect(category).toMatch(/@@index\(\[campusId, isActive, label, id\]\)/);
    expect(block('model', 'Campus')).toMatch(
      /forumCategories\s+ForumCategory\[\]/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("campusId", "category"\)[\s\S]*REFERENCES "ForumCategory"\("campusId", "slug"\)[\s\S]*ON DELETE RESTRICT/,
    );
  });

  it('stores nullable discussion authors and a complete authenticated tree-hole envelope', () => {
    const post = block('model', 'ForumPost');
    expect(post).toMatch(/kind\s+ForumPostKind/);
    expect(post).toMatch(/authorId\s+String\?/);
    expect(post).toMatch(/anonymousCiphertext\s+String\?\s+@db\.Text/);
    expect(post).toMatch(
      /anonymousFingerprint\s+String\?\s+@db\.VarChar\(64\)/,
    );
    expect(post).toMatch(/anonymousKeyVersion\s+Int\?/);
    expect(post).toMatch(
      /publicCode\s+String\?\s+@unique\s+@db\.VarChar\(12\)/,
    );
    expect(post).toMatch(/title\s+String\s+@db\.VarChar\(200\)/);
    expect(post).toMatch(/body\s+String\s+@db\.Text/);
    expect(post).toMatch(/category\s+String\s+@db\.VarChar\(64\)/);
    expect(post).toMatch(/status\s+ContentStatus\s+@default\(DRAFT\)/);
    expect(post).toMatch(
      /categoryDefinition\s+ForumCategory\s+@relation\((?:"ForumPostCategory", )?fields: \[campusId, category\], references: \[campusId, slug\], onDelete: Restrict\)/,
    );
    expect(post).toMatch(
      /@@index\(\[campusId, kind, status, createdAt, id\]\)/,
    );
    expect(post).not.toMatch(/anonymous(?:Iv|Tag)/);

    expect(migration).toContain('ForumPost_identity_check');
    expect(migration).toMatch(
      /"kind" = 'DISCUSSION'[\s\S]*"authorId" IS NOT NULL[\s\S]*"anonymousCiphertext" IS NULL[\s\S]*"anonymousFingerprint" IS NULL[\s\S]*"anonymousKeyVersion" IS NULL[\s\S]*"publicCode" IS NULL/,
    );
    expect(migration).toMatch(
      /"kind" = 'TREE_HOLE'[\s\S]*"authorId" IS NULL[\s\S]*"anonymousCiphertext" IS NOT NULL[\s\S]*"anonymousFingerprint" IS NOT NULL[\s\S]*"anonymousKeyVersion" IS NOT NULL[\s\S]*"publicCode" IS NOT NULL/,
    );
    expect(migration).toContain('complete authenticated encryption envelope');
  });

  it('keeps comments one level and rejects every tree-hole comment reference', () => {
    const comment = block('model', 'ForumComment');
    expect(comment).toMatch(/postId\s+String/);
    expect(comment).toMatch(/authorId\s+String/);
    expect(comment).toMatch(/body\s+String\s+@db\.Text/);
    expect(comment).toMatch(/status\s+ContentStatus\s+@default\(PUBLISHED\)/);
    expect(comment).toMatch(/@@index\(\[postId, status, createdAt, id\]\)/);
    expect(comment).not.toMatch(/parent/i);

    expect(migration).toMatch(
      /CREATE TRIGGER "ForumComment_discussion_only"[\s\S]*BEFORE INSERT OR UPDATE OF "postId" ON "ForumComment"[\s\S]*EXECUTE FUNCTION "_reject_tree_hole_comment"/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "ForumPost_commented_kind_guard"[\s\S]*BEFORE UPDATE OF "kind" ON "ForumPost"[\s\S]*EXECUTE FUNCTION "_protect_commented_forum_post_kind"/,
    );
    expect(migration).toMatch(
      /SELECT "kind"::text[\s\S]*WHERE "id" = \$1 FOR UPDATE/,
    );
    expect(migration).not.toContain('FOR KEY SHARE');
  });

  it('allows only one like per user and adds forum report targets safely', () => {
    const like = block('model', 'ForumLike');
    expect(like).toMatch(/userId\s+String/);
    expect(like).toMatch(/postId\s+String/);
    expect(like).toMatch(/@@unique\(\[userId, postId\]\)/);
    expect(like).toMatch(/@@index\(\[postId, createdAt, id\]\)/);

    const reportTargets = block('enum', 'ReportTargetType');
    expect(reportTargets).toMatch(/\bFORUM_POST\b/);
    expect(reportTargets).toMatch(/\bFORUM_COMMENT\b/);
    expect(migration).toMatch(
      /ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'FORUM_POST'/,
    );
    expect(migration).toMatch(
      /ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'FORUM_COMMENT'/,
    );
  });

  it('seeds the approved Chinese categories idempotently without sample posts', () => {
    for (const label of [
      '校园生活',
      '学习互助',
      '失物招领',
      '兴趣交流',
      '其他',
    ]) {
      expect(seed).toContain(`label: '${label}'`);
    }
    expect(seed).toContain('for (const category of forumCategories)');
    expect(seed).toContain('db.forumCategory.upsert({');
    expect(seed).toContain('campusId_slug: {');
    expect(seed).not.toContain('db.forumPost.create({');
  });

  it('keeps the forum migration expand-only', () => {
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/COMMIT;\s*$/);
    expect(migration).not.toMatch(
      /\bDROP\s+(?:TABLE|TYPE|COLUMN|CONSTRAINT|INDEX)\b/i,
    );
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b|\bTRUNCATE\s+TABLE\b/i);
  });
});
