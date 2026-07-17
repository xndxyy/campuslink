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
const seedDataSource = readSource('../../prisma/seed-data.ts');
const integrationSchemaSource = readSource(
  '../integration/schema-constraints.test.ts',
);
const integrationForumSource = readSource('../integration/forum.test.ts');

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
    expect(migration).toMatch(
      /char_length\("anonymousCiphertext"\) > 0[\s\S]*char_length\("anonymousCiphertext"\) <= 2048/,
    );
    expect(integrationForumSource).toContain(
      "it('rejects an oversized serialized tree-hole envelope at the database boundary'",
    );
    expect(integrationForumSource).toContain('INSERT INTO "ForumPost"');
    expect(integrationForumSource).toContain("code: '23514'");
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
      /CREATE TRIGGER "ForumComment_ownership_guard"[\s\S]*BEFORE INSERT OR UPDATE OF "postId", "authorId" ON "ForumComment"[\s\S]*EXECUTE FUNCTION "_reject_tree_hole_comment"/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "ForumPost_commented_kind_guard"[\s\S]*BEFORE UPDATE OF "kind" ON "ForumPost"[\s\S]*EXECUTE FUNCTION "_protect_commented_forum_post_kind"/,
    );
    expect(migration).toMatch(
      /SELECT "kind"::text[\s\S]*WHERE "id" = \$1 FOR UPDATE/,
    );
  });

  it('locks comment parents in user then post order and keeps ownership immutable', () => {
    const commentGuard =
      migration.match(
        /CREATE FUNCTION "_reject_tree_hole_comment"\(\)([\s\S]*?)\n\$\$;/,
      )?.[1] ?? '';
    const userLock = commentGuard.indexOf(
      'SELECT TRUE FROM %I.%I WHERE "id" = $1 FOR KEY SHARE',
    );
    const postLock = commentGuard.indexOf(
      'SELECT "kind"::text FROM %I.%I WHERE "id" = $1 FOR UPDATE',
    );

    expect(commentGuard).toContain("IF TG_OP = 'UPDATE' THEN");
    expect(commentGuard).toContain(
      'NEW."postId" IS DISTINCT FROM OLD."postId"',
    );
    expect(commentGuard).toContain(
      'NEW."authorId" IS DISTINCT FROM OLD."authorId"',
    );
    expect(commentGuard).toContain('Comment ownership is immutable');
    expect(userLock).toBeGreaterThan(-1);
    expect(postLock).toBeGreaterThan(userLock);
  });

  it('checks existing comments by the pre-update post id', () => {
    const reverseKindGuard =
      migration.match(
        /CREATE FUNCTION "_protect_commented_forum_post_kind"\(\)([\s\S]*?)\n\$\$;/,
      )?.[1] ?? '';

    expect(reverseKindGuard).toContain('USING OLD."id"');
    expect(reverseKindGuard).not.toContain('USING NEW."id"');
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

  it('indexes every confirmed forum discovery and identity lookup', () => {
    const post = block('model', 'ForumPost');
    expect(post).toMatch(
      /@@index\(\[campusId, kind, status, category, createdAt, id\], map: "ForumPost_campusId_kind_status_category_createdAt_id_idx"\)/,
    );
    expect(post).toMatch(
      /@@index\(\[campusId, anonymousFingerprint, createdAt, id\], map: "ForumPost_campusId_anonymousFingerprint_createdAt_id_idx"\)/,
    );
    expect(post).toMatch(
      /@@index\(\[title\(ops: raw\("gin_trgm_ops"\)\)\], type: Gin, map: "ForumPost_title_trgm_idx"\)/,
    );
    expect(post).toMatch(
      /@@index\(\[body\(ops: raw\("gin_trgm_ops"\)\)\], type: Gin, map: "ForumPost_body_trgm_idx"\)/,
    );
    expect(migration).toContain(
      '"ForumPost_campusId_kind_status_category_createdAt_id_idx"',
    );
    expect(migration).toContain(
      '"ForumPost_campusId_anonymousFingerprint_createdAt_id_idx"',
    );
    expect(migration).toMatch(
      /CREATE INDEX "ForumPost_title_trgm_idx"[\s\S]*USING GIN \("title" gin_trgm_ops\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "ForumPost_body_trgm_idx"[\s\S]*USING GIN \("body" gin_trgm_ops\)/,
    );
  });

  it('keeps forum category campus ownership immutable in SQL and integration coverage', () => {
    expect(migration).toMatch(
      /CREATE TRIGGER "ForumCategory_immutable_campusId"[\s\S]*BEFORE UPDATE OF "campusId" ON "ForumCategory"[\s\S]*EXECUTE FUNCTION "_prevent_forum_category_campus_change"/,
    );
    expect(integrationSchemaSource).toContain('UPDATE "ForumCategory"');
    expect(integrationSchemaSource).toContain(
      'Forum category campus ownership is immutable',
    );
    expect(integrationSchemaSource).toContain("code: '23514'");
    expect(integrationSchemaSource).toContain('categoryCampusId');
  });

  it('proves duplicate likes through parameterized direct PostgreSQL', () => {
    const interactionTest = integrationSchemaSource.slice(
      integrationSchemaSource.indexOf(
        "it('enforces one like and prevents a commented discussion becoming a tree hole'",
      ),
      integrationSchemaSource.indexOf(
        "it('allows one cover per announcement and rejects a duplicate cover'",
      ),
    );

    expect(interactionTest).toMatch(/directClient\.query\(/);
    expect(interactionTest).toContain('INSERT INTO "ForumLike"');
    expect(interactionTest).toContain('VALUES ($1, $2, $3)');
    expect(interactionTest).toContain('reporterId');
    expect(interactionTest).toContain('post.id');
    expect(interactionTest).toContain("code: '23505'");
  });

  it('seeds the approved Chinese categories idempotently without sample posts', () => {
    for (const label of [
      '求助建议',
      '情感交流',
      '校园生活',
      '学习互助',
      '失物招领',
      '兴趣交流',
      '其他',
    ]) {
      expect(seedDataSource).toContain(`label: '${label}'`);
    }
    expect(seed).toContain('seedForumCategories(db, campus.id)');
    expect(seed).not.toContain('const forumCategories =');
    expect(seed).not.toContain('db.forumPost.create({');
  });

  it('covers bounded two-client comment lock serialization without fixed sleeps', () => {
    expect(integrationSchemaSource).toContain(
      'const DATABASE_LOCK_WAIT_TIMEOUT_MS = 2_000',
    );
    expect(integrationSchemaSource).toContain(
      'async function waitForDatabaseLock',
    );
    expect(integrationSchemaSource).toContain('FROM pg_stat_activity');
    expect(integrationSchemaSource).toContain('wait_event_type');
    expect(integrationSchemaSource).toContain("SET statement_timeout = '3s'");
    expect(integrationSchemaSource).toContain(
      "it('serializes comment insertion against a post kind update'",
    );
    expect(integrationSchemaSource).toContain(
      "it('orders user deletion before self-comment parent locking'",
    );
    expect(integrationSchemaSource).not.toContain('setTimeout(resolve, 1_000)');
  });

  it('covers both report-lock commit orders with bounded database barriers', () => {
    expect(integrationForumSource).toContain(
      'const DATABASE_LOCK_WAIT_TIMEOUT_MS = 2_000',
    );
    expect(integrationForumSource).toContain(
      'async function waitForForumDatabaseLock',
    );
    expect(integrationForumSource).toContain('FROM pg_stat_activity');
    expect(integrationForumSource).toContain('wait_event_type');
    expect(integrationForumSource).toContain("SET statement_timeout = '3s'");
    expect(integrationForumSource).toContain(
      "it('rechecks a closed report after a concurrent close commits'",
    );
    expect(integrationForumSource).toContain(
      "it('holds the report row lock until a successful reveal commits'",
    );
    expect(integrationForumSource).not.toContain('setTimeout(resolve, 1_000)');
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
