export type TagScope = 'RESOURCE' | 'MARKETPLACE' | 'CAMPUS_WORK';

export interface TagSelectionInput {
  customTags: string[];
  presetTagIds: string[];
}

export type TagValidationCode =
  | 'DUPLICATE_CUSTOM'
  | 'DUPLICATE_PRESET'
  | 'EMPTY_SLUG'
  | 'INACTIVE_TAG'
  | 'INVALID_ACTOR'
  | 'INVALID_INPUT'
  | 'INVALID_LABEL'
  | 'POLICY_REJECTED'
  | 'TAG_COLLISION'
  | 'TOO_MANY_CUSTOM'
  | 'TOO_MANY_TAGS';

export class TagValidationError extends Error {
  constructor(
    public readonly code: TagValidationCode,
    message = 'Invalid tag input',
  ) {
    super(message);
    this.name = 'TagValidationError';
  }
}

const completeHtmlTag = /<\/?[a-z][^>]*>/i;
const unsafeHtmlSyntax =
  /<!--|<!doctype\b|javascript\s*:|<\s*\/?\s*(?:script|style|iframe|img|svg|object|embed|link|meta|form|input|button|textarea|select|option)\b[^>]*$/i;
const forbiddenControl = /[\p{Cc}\p{Cf}]/u;

export function normalizeTagLabel(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TagValidationError('INVALID_LABEL');
  }
  const normalized = value
    .normalize('NFKC')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim();
  if (
    normalized.length < 1 ||
    normalized.length > 32 ||
    forbiddenControl.test(normalized) ||
    completeHtmlTag.test(normalized) ||
    unsafeHtmlSyntax.test(normalized)
  ) {
    throw new TagValidationError('INVALID_LABEL');
  }
  return normalized;
}

export function createTagSlug(value: unknown): string {
  const slug = normalizeTagLabel(value)
    .toUpperCase()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, '-')
    .replace(/\p{White_Space}+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const bounded = Array.from(slug).slice(0, 40).join('').replace(/-$/g, '');
  if (!bounded) throw new TagValidationError('EMPTY_SLUG');
  return bounded;
}

export function parseTagSelectionInput(value: unknown): TagSelectionInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TagValidationError('INVALID_INPUT');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== 2 ||
    !keys.includes('customTags') ||
    !keys.includes('presetTagIds') ||
    !Array.isArray(record.customTags) ||
    !Array.isArray(record.presetTagIds)
  ) {
    throw new TagValidationError('INVALID_INPUT');
  }
  if (record.customTags.length > 2) {
    throw new TagValidationError('TOO_MANY_CUSTOM');
  }
  if (record.presetTagIds.length > 5) {
    throw new TagValidationError('TOO_MANY_TAGS');
  }
  const presetTagIds = record.presetTagIds.map((value) => {
    if (typeof value !== 'string') {
      throw new TagValidationError('INVALID_INPUT');
    }
    const id = value.trim();
    if (id.length < 1 || id.length > 191) {
      throw new TagValidationError('INVALID_INPUT');
    }
    return id;
  });
  if (new Set(presetTagIds).size !== presetTagIds.length) {
    throw new TagValidationError('DUPLICATE_PRESET');
  }
  const customTags = record.customTags.map(normalizeTagLabel);
  if (new Set(customTags).size !== customTags.length) {
    throw new TagValidationError('DUPLICATE_CUSTOM');
  }
  const customSlugs = customTags.map(createTagSlug);
  if (new Set(customSlugs).size !== customSlugs.length) {
    throw new TagValidationError('TAG_COLLISION');
  }
  return { customTags, presetTagIds };
}
