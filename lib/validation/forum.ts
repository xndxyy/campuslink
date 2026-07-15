import { z } from 'zod';

const plainText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !/[<>]/.test(value), 'Plain text only');

const categorySlug = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const forumIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(191)
  .regex(/^[A-Za-z0-9_-]+$/);

export const createForumPostSchema = z
  .object({
    body: plainText(10, 5_000),
    category: categorySlug,
    kind: z.enum(['DISCUSSION', 'TREE_HOLE']),
    title: plainText(3, 200),
  })
  .strict();

export const updateForumPostSchema = z
  .object({
    body: plainText(10, 5_000).optional(),
    category: categorySlug.optional(),
    title: plainText(3, 200).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.body !== undefined ||
      value.category !== undefined ||
      value.title !== undefined,
    'At least one change is required',
  );

const boundedPage = z.coerce.number().int().min(1).max(10_000);

export const forumListQuerySchema = z
  .object({
    category: categorySlug.optional(),
    page: boundedPage.default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    query: plainText(1, 100).optional(),
    view: z.enum(['discussion', 'tree-hole']).default('discussion'),
  })
  .strict();

export const createForumCommentSchema = z
  .object({ body: plainText(2, 1_000) })
  .strict();

export const updateForumCommentSchema = z
  .object({
    body: plainText(2, 1_000),
    commentId: forumIdSchema,
  })
  .strict();

export const deleteForumCommentSchema = z
  .object({ commentId: forumIdSchema })
  .strict();

export type CreateForumPostInput = z.infer<typeof createForumPostSchema>;
export type CreateForumCommentInput = z.infer<typeof createForumCommentSchema>;
export type DeleteForumCommentInput = z.infer<typeof deleteForumCommentSchema>;
export type ForumListQuery = z.infer<typeof forumListQuerySchema>;
export type UpdateForumCommentInput = z.infer<typeof updateForumCommentSchema>;
export type UpdateForumPostInput = z.infer<typeof updateForumPostSchema>;
