import { z } from 'zod';
import { createTagSlug, normalizeTagLabel } from './tags';

const completeHtmlTag = /<\/?[a-z][^>]*>/i;
const unsafeHtmlSyntax =
  /<!--|<!doctype\b|javascript\s*:|<\s*\/?\s*(?:script|style|iframe|img|svg|object|embed|link|meta|form|input|button|textarea|select|option)\b[^>]*$/i;
export const MAX_PRICE_CENTS = 2_147_483_647;
const yuanPricePattern = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;

export function yuanTextToCents(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  const cents =
    BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'));
  return Number(cents);
}

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
  .max(8)
  .refine(
    (values) => new Set(values).size === values.length,
    'Asset IDs must be unique',
  );

const requiredAssetIds = assetIds.refine((values) => values.length > 0, {
  message: 'At least one asset is required',
});

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
  .refine((value) => yuanPricePattern.test(value), {
    message: 'Price must be a non-negative amount with at most two decimals',
  })
  .transform(yuanTextToCents)
  .refine(
    (value) => Number.isSafeInteger(value) && value <= MAX_PRICE_CENTS,
    'Price is too large',
  );

function optionalYuanPrice(label: '最低价' | '最高价') {
  return z
    .string()
    .trim()
    .transform((value) => (value === '' ? undefined : value))
    .pipe(
      z
        .string()
        .regex(yuanPricePattern, `${label}格式不正确`)
        .transform((raw) => ({ cents: yuanTextToCents(raw), raw }))
        .refine(({ cents }) => cents <= MAX_PRICE_CENTS, {
          message: `${label}超出允许范围`,
        })
        .optional(),
    )
    .optional();
}

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
    summary: plainText(0, 5_000, 'Summary'),
    title: plainText(3, 200, 'Title'),
  })
  .strict()
  .superRefine(enforceTagLimit);

export const createMarketplaceItemSchema = z
  .object({
    assetIds: requiredAssetIds,
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
    summary: plainText(0, 5_000, 'Summary'),
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
export const updateCampusWorkSchema = createCampusWorkSchema;

export const contentListQuerySchema = z
  .object({
    condition: z.enum(marketplaceConditions).optional(),
    location: z.string().trim().max(200).optional(),
    maxPrice: optionalYuanPrice('最高价'),
    minPrice: optionalYuanPrice('最低价'),
    page: z.coerce.number().int().min(1).max(50).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(12),
    search: z.string().trim().max(80).optional(),
    tag: z.string().trim().max(32).optional(),
  })
  .strict()
  .superRefine(({ maxPrice, minPrice }, context) => {
    if (
      maxPrice !== undefined &&
      minPrice !== undefined &&
      maxPrice.cents < minPrice.cents
    ) {
      context.addIssue({
        code: 'custom',
        message: '最高价不能低于最低价',
        path: ['maxPrice'],
      });
    }
  })
  .transform(({ maxPrice, minPrice, ...query }) => ({
    ...query,
    ...(maxPrice === undefined ? {} : { maxPriceCents: maxPrice.cents }),
    ...(minPrice === undefined ? {} : { minPriceCents: minPrice.cents }),
  }));

export type CreateResourceInput = z.output<typeof createResourceSchema>;
export type CreateMarketplaceItemInput = z.output<
  typeof createMarketplaceItemSchema
>;
export type CreateCampusWorkInput = z.output<typeof createCampusWorkSchema>;
export type UpdateResourceInput = z.output<typeof updateResourceSchema>;
export type UpdateMarketplaceItemInput = z.output<
  typeof updateMarketplaceItemSchema
>;
export type UpdateCampusWorkInput = z.output<typeof updateCampusWorkSchema>;
export type ContentListQuery = z.output<typeof contentListQuerySchema>;
