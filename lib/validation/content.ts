import { z } from 'zod';

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

const tags = z
  .array(plainText(1, 32, 'Tag'))
  .max(8)
  .transform((values) => [
    ...new Set(values.map((value) => value.toLocaleLowerCase('en-US'))),
  ]);

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
    courseCode: plainText(0, 64, 'Course code')
      .transform((value) => value.replace(/\s+/g, ' ').toUpperCase())
      .optional()
      .transform((value) => value || undefined),
    summary: plainText(20, 5_000, 'Summary'),
    tags,
    title: plainText(3, 200, 'Title'),
  })
  .strict();

export const createMarketplaceItemSchema = z
  .object({
    assetIds,
    condition: z.enum(marketplaceConditions),
    contact: plainText(3, 300, 'Contact preference'),
    description: plainText(20, 5_000, 'Description'),
    pickupArea: plainText(2, 200, 'Pickup area'),
    price,
    title: plainText(3, 200, 'Title'),
  })
  .strict()
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

export const updateResourceSchema = createResourceSchema.omit({
  assetIds: true,
});
export const updateMarketplaceItemSchema = z
  .object({
    condition: z.enum(marketplaceConditions),
    contact: plainText(3, 300, 'Contact preference'),
    description: plainText(20, 5_000, 'Description'),
    pickupArea: plainText(2, 200, 'Pickup area'),
    price,
    title: plainText(3, 200, 'Title'),
  })
  .strict()
  .transform(({ price, ...value }) => ({ ...value, priceCents: price }));
export const updateJobSchema = createJobSchema;

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
export type UpdateResourceInput = z.output<typeof updateResourceSchema>;
export type UpdateMarketplaceItemInput = z.output<
  typeof updateMarketplaceItemSchema
>;
export type UpdateJobInput = z.output<typeof updateJobSchema>;
export type ContentListQuery = z.output<typeof contentListQuerySchema>;
