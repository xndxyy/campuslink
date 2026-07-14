import { z } from 'zod';
import { createTagSlug, normalizeTagLabel } from './tags';

const completeHtmlTag = /<\/?[a-z][^>]*>/i;
const unsafeHtmlSyntax =
  /<!--|<!doctype\b|javascript\s*:|<\s*\/?\s*(?:script|style|iframe|img|svg|object|embed|link|meta|form|input|button|textarea|select|option)\b[^>]*$/i;
export const MAX_PRICE_CENTS = 2_147_483_647;

function containsHtmlLikeSyntax(value: string) {
  return completeHtmlTag.test(value) || unsafeHtmlSyntax.test(value);
}

export function plainText(min: number, max: number, label: string) {
  return z
    .string()
    .trim()
    .min(min, `${label} is too short`)
    .max(max, `${label} is too long`)
    .refine(
      (value) => !containsHtmlLikeSyntax(value),
      `${label} must be plain text`,
    );
}

const assetIds = z
  .array(z.string().trim().min(1).max(128))
  .min(1)
  .max(8)
  .refine(
    (values) => new Set(values).size === values.length,
    'Asset IDs must be unique',
  );

const presetTagIds = z
  .array(z.string().trim().min(1).max(191))
  .max(5)
  .refine(
    (values) => new Set(values).size === values.length,
    'Preset tag IDs must be unique',
  );

const customTag = z.string().transform((value, context) => {
  try {
    return normalizeTagLabel(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'Invalid custom tag' });
    return z.NEVER;
  }
});

const customTags = z
  .array(customTag)
  .max(2)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: 'custom',
        message: 'Custom tags must be unique',
      });
    }
    const slugs = values.map(createTagSlug);
    if (new Set(slugs).size !== slugs.length) {
      context.addIssue({
        code: 'custom',
        message: 'Custom tags must be distinct',
      });
    }
  });

const tagSelectionShape = { customTags, presetTagIds };

function enforceTagLimit(
  value: { customTags: string[]; presetTagIds: string[] },
  context: z.RefinementCtx,
) {
  if (value.customTags.length + value.presetTagIds.length > 5) {
    context.addIssue({ code: 'custom', message: 'Select at most five tags' });
  }
}

const price = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(value), {
    message: 'Price must be a non-negative amount with at most two decimals',
  })
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  })
  .refine(
    (value) => Number.isSafeInteger(value) && value <= MAX_PRICE_CENTS,
    'Price is too large',
  );

export const marketplaceConditions = [
  'NEW',
  'LIKE_NEW',
  'GOOD',
  'FAIR',
  'POOR',
] as const;

export const createResourceSchema = z
  .object({
    assetIds,
    ...tagSelectionShape,
    summary: plainText(20, 5_000, 'Summary'),
    title: plainText(3, 200, 'Title'),
  })
  .strict()
  .superRefine(enforceTagLimit);

export const createMarketplaceItemSchema = z
  .object({
    assetIds,
    condition: z.enum(marketplaceConditions),
    contact: plainText(3, 300, 'Contact preference'),
    ...tagSelectionShape,
    description: plainText(20, 5_000, 'Description'),
    pickupArea: plainText(2, 200, 'Pickup area'),
    price,
    title: plainText(3, 200, 'Title'),
  })
  .strict()
  .superRefine(enforceTagLimit)
  .transform(({ price, ...value }) => ({ ...value, priceCents: price }));

export const createJobSchema = z
  .object({
    company: plainText(2, 200, 'Company'),
    description: plainText(20, 5_000, 'Description'),
    location: plainText(2, 200, 'Location'),
    payText: plainText(2, 200, 'Pay'),
    title: plainText(3, 200, 'Title'),
  })
  .strict();

export const createCampusWorkSchema = z
  .object({
    contact: plainText(3, 300, 'Contact preference'),
    ...tagSelectionShape,
    description: plainText(20, 5_000, 'Description'),
    location: plainText(2, 200, 'Location'),
    payText: plainText(2, 200, 'Pay'),
    title: plainText(3, 200, 'Title'),
  })
  .strict()
  .superRefine(enforceTagLimit);

export const updateResourceSchema = z
  .object({
    ...tagSelectionShape,
    summary: plainText(20, 5_000, 'Summary'),
    title: plainText(3, 200, 'Title'),
  })
  .strict()
  .superRefine(enforceTagLimit);
export const updateMarketplaceItemSchema = z
  .object({
    condition: z.enum(marketplaceConditions),
    contact: plainText(3, 300, 'Contact preference'),
    ...tagSelectionShape,
    description: plainText(20, 5_000, 'Description'),
    pickupArea: plainText(2, 200, 'Pickup area'),
    price,
    title: plainText(3, 200, 'Title'),
  })
  .strict()
  .superRefine(enforceTagLimit)
  .transform(({ price, ...value }) => ({ ...value, priceCents: price }));
export const updateJobSchema = createJobSchema;
export const updateCampusWorkSchema = createCampusWorkSchema;

export const contentListQuerySchema = z
  .object({
    condition: z.enum(marketplaceConditions).optional(),
    company: z.string().trim().max(200).optional(),
    courseCode: z.string().trim().max(64).optional(),
    location: z.string().trim().max(200).optional(),
    maxPriceCents: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(MAX_PRICE_CENTS)
      .optional(),
    minPriceCents: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(MAX_PRICE_CENTS)
      .optional(),
    page: z.coerce.number().int().min(1).max(50).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(12),
    search: z.string().trim().max(80).optional(),
    tag: z.string().trim().max(32).optional(),
  })
  .strict();

export type CreateResourceInput = z.output<typeof createResourceSchema>;
export type CreateMarketplaceItemInput = z.output<
  typeof createMarketplaceItemSchema
>;
export type CreateJobInput = z.output<typeof createJobSchema>;
export type CreateCampusWorkInput = z.output<typeof createCampusWorkSchema>;
export type UpdateResourceInput = z.output<typeof updateResourceSchema>;
export type UpdateMarketplaceItemInput = z.output<
  typeof updateMarketplaceItemSchema
>;
export type UpdateJobInput = z.output<typeof updateJobSchema>;
export type UpdateCampusWorkInput = z.output<typeof updateCampusWorkSchema>;
export type ContentListQuery = z.output<typeof contentListQuerySchema>;
