BEGIN;

ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'FORUM_POST';
ALTER TYPE "ReportTargetType" ADD VALUE IF NOT EXISTS 'FORUM_COMMENT';

CREATE TYPE "ForumPostKind" AS ENUM ('DISCUSSION', 'TREE_HOLE');

CREATE TABLE "ForumCategory" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "slug" VARCHAR(64) NOT NULL,
  "label" VARCHAR(100) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ForumCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ForumPost" (
  "id" TEXT NOT NULL,
  "campusId" TEXT NOT NULL,
  "kind" "ForumPostKind" NOT NULL,
  "authorId" TEXT,
  -- Stores the complete authenticated encryption envelope, including IV and tag.
  "anonymousCiphertext" TEXT,
  "anonymousFingerprint" VARCHAR(64),
  "anonymousKeyVersion" INTEGER,
  "publicCode" VARCHAR(12),
  "title" VARCHAR(200) NOT NULL,
  "body" TEXT NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ForumPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ForumPost_identity_check" CHECK (
    (
      "kind" = 'DISCUSSION'
      AND "authorId" IS NOT NULL
      AND "anonymousCiphertext" IS NULL
      AND "anonymousFingerprint" IS NULL
      AND "anonymousKeyVersion" IS NULL
      AND "publicCode" IS NULL
    )
    OR
    (
      "kind" = 'TREE_HOLE'
      AND "authorId" IS NULL
      AND "anonymousCiphertext" IS NOT NULL
      AND char_length("anonymousCiphertext") > 0
      AND char_length("anonymousCiphertext") <= 2048
      AND "anonymousFingerprint" IS NOT NULL
      AND char_length("anonymousFingerprint") = 64
      AND "anonymousKeyVersion" IS NOT NULL
      AND "anonymousKeyVersion" > 0
      AND "publicCode" IS NOT NULL
      AND char_length("publicCode") = 12
    )
  )
);

CREATE TABLE "ForumComment" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ForumComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ForumLike" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ForumLike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ForumCategory_campusId_slug_key"
  ON "ForumCategory"("campusId", "slug");
CREATE INDEX "ForumCategory_campusId_isActive_label_id_idx"
  ON "ForumCategory"("campusId", "isActive", "label", "id");

CREATE UNIQUE INDEX "ForumPost_publicCode_key" ON "ForumPost"("publicCode");
CREATE INDEX "ForumPost_campusId_kind_status_createdAt_id_idx"
  ON "ForumPost"("campusId", "kind", "status", "createdAt", "id");
CREATE INDEX "ForumPost_campusId_kind_status_category_createdAt_id_idx"
  ON "ForumPost"("campusId", "kind", "status", "category", "createdAt", "id");
CREATE INDEX "ForumPost_campusId_anonymousFingerprint_createdAt_id_idx"
  ON "ForumPost"("campusId", "anonymousFingerprint", "createdAt", "id");
CREATE INDEX "ForumPost_authorId_status_createdAt_id_idx"
  ON "ForumPost"("authorId", "status", "createdAt", "id");
CREATE INDEX "ForumPost_title_trgm_idx"
  ON "ForumPost" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "ForumPost_body_trgm_idx"
  ON "ForumPost" USING GIN ("body" gin_trgm_ops);

CREATE INDEX "ForumComment_postId_status_createdAt_id_idx"
  ON "ForumComment"("postId", "status", "createdAt", "id");
CREATE INDEX "ForumComment_authorId_createdAt_id_idx"
  ON "ForumComment"("authorId", "createdAt", "id");

CREATE UNIQUE INDEX "ForumLike_userId_postId_key"
  ON "ForumLike"("userId", "postId");
CREATE INDEX "ForumLike_postId_createdAt_id_idx"
  ON "ForumLike"("postId", "createdAt", "id");

ALTER TABLE "ForumCategory"
  ADD CONSTRAINT "ForumCategory_campusId_fkey"
  FOREIGN KEY ("campusId") REFERENCES "Campus"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ForumPost"
  ADD CONSTRAINT "ForumPost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ForumPost"
  ADD CONSTRAINT "ForumPost_campusId_category_fkey"
  FOREIGN KEY ("campusId", "category")
  REFERENCES "ForumCategory"("campusId", "slug")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ForumComment"
  ADD CONSTRAINT "ForumComment_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "ForumPost"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ForumComment"
  ADD CONSTRAINT "ForumComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ForumLike"
  ADD CONSTRAINT "ForumLike_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ForumLike"
  ADD CONSTRAINT "ForumLike_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "ForumPost"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "_prevent_forum_category_campus_change"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW."campusId" IS DISTINCT FROM OLD."campusId" THEN
    RAISE EXCEPTION 'Forum category campus ownership is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "ForumCategory_immutable_campusId"
BEFORE UPDATE OF "campusId" ON "ForumCategory"
FOR EACH ROW
EXECUTE FUNCTION "_prevent_forum_category_campus_change"();

CREATE FUNCTION "_reject_tree_hole_comment"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  author_exists BOOLEAN;
  post_kind TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."postId" IS DISTINCT FROM OLD."postId"
      OR NEW."authorId" IS DISTINCT FROM OLD."authorId" THEN
      RAISE EXCEPTION 'Comment ownership is immutable'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT TRUE FROM %I.%I WHERE "id" = $1 FOR KEY SHARE',
    TG_TABLE_SCHEMA,
    'User'
  )
  INTO author_exists
  USING NEW."authorId";

  -- Missing parents are left to the existing foreign-key constraints.
  IF author_exists IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT "kind"::text FROM %I.%I WHERE "id" = $1 FOR UPDATE',
    TG_TABLE_SCHEMA,
    'ForumPost'
  )
  INTO post_kind
  USING NEW."postId";

  IF post_kind = 'TREE_HOLE' THEN
    RAISE EXCEPTION 'Tree-hole posts do not accept comments'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "ForumComment_ownership_guard"
BEFORE INSERT OR UPDATE OF "postId", "authorId" ON "ForumComment"
FOR EACH ROW
EXECUTE FUNCTION "_reject_tree_hole_comment"();

CREATE FUNCTION "_protect_commented_forum_post_kind"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  has_comments BOOLEAN;
BEGIN
  IF NEW."kind" = 'TREE_HOLE' AND OLD."kind" IS DISTINCT FROM NEW."kind" THEN
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE "postId" = $1)',
      TG_TABLE_SCHEMA,
      'ForumComment'
    )
    INTO has_comments
    USING OLD."id";

    IF has_comments THEN
      RAISE EXCEPTION 'Commented forum posts cannot become tree holes'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "ForumPost_commented_kind_guard"
BEFORE UPDATE OF "kind" ON "ForumPost"
FOR EACH ROW
EXECUTE FUNCTION "_protect_commented_forum_post_kind"();

COMMIT;
