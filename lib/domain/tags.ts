import {
  TagValidationError,
  createTagSlug,
  normalizeTagLabel,
  parseTagSelectionInput,
  type TagScope,
  type TagSelectionInput,
} from '@/lib/validation/tags';
import { isTransactionConflict } from '@/lib/domain/transaction-errors';

type Role = 'STUDENT' | 'MODERATOR' | 'ADMIN';

export interface TagActor {
  campusId: string;
  id: string;
  role: Role;
}

export interface VerifiedTagActor extends TagActor {
  emailVerifiedAt: Date;
  status: 'ACTIVE';
}

export interface TagRecord extends Record<string, unknown> {
  campusId: string;
  id: string;
  isActive: boolean;
  isPreset: boolean;
  label: string;
  scope: TagScope;
  slug?: string;
}

interface CountResult {
  count: number;
}

export interface TagAdapter {
  $transaction<T>(
    operation: (tx: TagAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  auditLog: {
    create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  tagDefinition: {
    create(args: Record<string, unknown>): Promise<TagRecord>;
    findMany(args: Record<string, unknown>): Promise<TagRecord[]>;
    findUnique(args: Record<string, unknown>): Promise<TagRecord | null>;
    updateMany(args: Record<string, unknown>): Promise<CountResult>;
    upsert(args: Record<string, unknown>): Promise<TagRecord>;
  };
}

export class TagForbiddenError extends Error {
  constructor() {
    super('Tag access is forbidden');
    this.name = 'TagForbiddenError';
  }
}

export class TagConflictError extends Error {
  constructor() {
    super('Tag state conflict');
    this.name = 'TagConflictError';
  }
}

const scopes = new Set<TagScope>(['RESOURCE', 'MARKETPLACE', 'CAMPUS_WORK']);

function validScope(value: TagScope): TagScope {
  if (!scopes.has(value)) throw new TagValidationError('INVALID_INPUT');
  return value;
}

function requireVerified(actor: VerifiedTagActor) {
  if (actor.status !== 'ACTIVE' || !(actor.emailVerifiedAt instanceof Date)) {
    throw new TagForbiddenError();
  }
}

function requireAdmin(actor: TagActor) {
  if (actor.role !== 'ADMIN') throw new TagForbiddenError();
}

function reason(value: string) {
  if (typeof value !== 'string') {
    throw new TagValidationError('INVALID_INPUT');
  }
  const trimmed = value.trim();
  if (trimmed.length < 5 || trimmed.length > 1000) {
    throw new TagValidationError('INVALID_INPUT');
  }
  return trimmed;
}

function tagId(value: string) {
  if (typeof value !== 'string') {
    throw new TagValidationError('INVALID_INPUT');
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 191) {
    throw new TagValidationError('INVALID_INPUT');
  }
  return trimmed;
}

function stableTagOrder<T extends { id: string; label: string }>(records: T[]) {
  return [...records].sort((left, right) => {
    if (left.label < right.label) return -1;
    if (left.label > right.label) return 1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

function minimalTag(record: TagRecord) {
  return { id: record.id, label: record.label };
}

function managedTag(record: TagRecord) {
  return {
    id: record.id,
    isActive: record.isActive,
    isPreset: record.isPreset,
    label: record.label,
  };
}

export interface ManagedTagCursor {
  id: string;
  label: string;
}

export interface ManagedTagQuery {
  cursor?: ManagedTagCursor;
  pageSize?: number;
}

export interface ManagedTagPage {
  hasNextPage: boolean;
  items: Array<ReturnType<typeof managedTag>>;
  nextCursor: string | null;
}

function validatedManagedTagCursor(cursor: ManagedTagCursor) {
  if (!cursor || typeof cursor !== 'object') {
    throw new TagValidationError('INVALID_INPUT');
  }
  const id = tagId(cursor.id);
  const label = normalizeTagLabel(cursor.label);
  if (id !== cursor.id || label !== cursor.label) {
    throw new TagValidationError('INVALID_INPUT');
  }
  return { id, label };
}

export function encodeManagedTagCursor(cursor: ManagedTagCursor): string {
  const valid = validatedManagedTagCursor(cursor);
  return Buffer.from(JSON.stringify([valid.label, valid.id])).toString(
    'base64url',
  );
}

function decodeManagedTagCursor(value: string) {
  if (!value || value.length > 512) {
    throw new TagValidationError('INVALID_INPUT');
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string'
    ) {
      throw new Error('invalid cursor');
    }
    const cursor = validatedManagedTagCursor({
      id: parsed[1],
      label: parsed[0],
    });
    if (encodeManagedTagCursor(cursor) !== value) {
      throw new Error('non-canonical cursor');
    }
    return cursor;
  } catch (error) {
    if (error instanceof TagValidationError) throw error;
    throw new TagValidationError('INVALID_INPUT');
  }
}

function singleQueryValue(params: URLSearchParams, key: string) {
  const values = params.getAll(key);
  if (values.length > 1) throw new TagValidationError('INVALID_INPUT');
  return values[0];
}

function managedPageSize(value: number | undefined) {
  const pageSize = value ?? 50;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new TagValidationError('INVALID_INPUT');
  }
  return pageSize;
}

export function parseManagedTagQuery(searchParams: URLSearchParams): {
  query: ManagedTagQuery;
  scope: TagScope;
} {
  const allowed = new Set(['scope', 'pageSize', 'cursor']);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key)) throw new TagValidationError('INVALID_INPUT');
  }
  const scopeValue = singleQueryValue(searchParams, 'scope');
  const scope = validScope(scopeValue as TagScope);
  const pageSizeValue = singleQueryValue(searchParams, 'pageSize');
  if (pageSizeValue !== undefined && !/^[1-9]\d*$/.test(pageSizeValue)) {
    throw new TagValidationError('INVALID_INPUT');
  }
  const pageSize = managedPageSize(
    pageSizeValue === undefined ? undefined : Number(pageSizeValue),
  );
  const cursorValue = singleQueryValue(searchParams, 'cursor');
  return {
    query: {
      ...(cursorValue !== undefined
        ? { cursor: decodeManagedTagCursor(cursorValue) }
        : {}),
      pageSize,
    },
    scope,
  };
}

export async function listAvailableTags(
  adapter: TagAdapter,
  actor: VerifiedTagActor,
  scopeValue: TagScope,
) {
  requireVerified(actor);
  const scope = validScope(scopeValue);
  const records = await adapter.tagDefinition.findMany({
    orderBy: [{ label: 'asc' }, { id: 'asc' }],
    select: { id: true, label: true },
    take: 100,
    where: {
      campusId: actor.campusId,
      isActive: true,
      isPreset: true,
      scope,
    },
  });
  return stableTagOrder(records).map(minimalTag);
}

export async function listManagedTags(
  adapter: TagAdapter,
  actor: TagActor,
  scopeValue: TagScope,
  query: ManagedTagQuery = {},
): Promise<ManagedTagPage> {
  requireAdmin(actor);
  const scope = validScope(scopeValue);
  const pageSize = managedPageSize(query.pageSize);
  const cursor = query.cursor
    ? validatedManagedTagCursor(query.cursor)
    : undefined;
  const records = await adapter.tagDefinition.findMany({
    orderBy: [{ label: 'asc' }, { id: 'asc' }],
    select: { id: true, isActive: true, isPreset: true, label: true },
    take: pageSize + 1,
    where: {
      campusId: actor.campusId,
      ...(cursor
        ? {
            OR: [
              { label: { gt: cursor.label } },
              { id: { gt: cursor.id }, label: cursor.label },
            ],
          }
        : {}),
      scope,
    },
  });
  const hasNextPage = records.length > pageSize;
  const items = records.slice(0, pageSize).map(managedTag);
  const last = items.at(-1);
  return {
    hasNextPage,
    items,
    nextCursor:
      hasNextPage && last
        ? encodeManagedTagCursor({ id: last.id, label: last.label })
        : null,
  };
}

export type CustomTagAssessment =
  boolean | { allowed: true } | { allowed: false; reason?: Uppercase<string> };

export interface TagResolutionPolicy {
  assessCustomTag?: (label: string) => Promise<CustomTagAssessment>;
}

const preparedSelectionBrand: unique symbol = Symbol('prepared-tag-selection');

export interface PreparedContentTagSelection {
  readonly [preparedSelectionBrand]: true;
  readonly actor: VerifiedTagActor;
  readonly customTags: ReadonlyArray<{ label: string; slug: string }>;
  readonly presetTagIds: readonly string[];
  readonly scope: TagScope;
}

export type TagResolutionTransaction = Pick<TagAdapter, 'tagDefinition'>;

export async function prepareContentTagSelection(
  actor: VerifiedTagActor,
  scopeValue: TagScope,
  inputValue: TagSelectionInput,
  policy: TagResolutionPolicy = {},
): Promise<PreparedContentTagSelection> {
  requireVerified(actor);
  const scope = validScope(scopeValue);
  const input = parseTagSelectionInput(inputValue);
  const customTags: Array<{ label: string; slug: string }> = [];
  for (const label of input.customTags) {
    if (policy.assessCustomTag) {
      let assessment: unknown;
      try {
        assessment = await policy.assessCustomTag(label);
      } catch {
        throw new TagValidationError('POLICY_REJECTED');
      }
      if (!isAllowedAssessment(assessment)) {
        throw new TagValidationError('POLICY_REJECTED');
      }
    }
    customTags.push(Object.freeze({ label, slug: createTagSlug(label) }));
  }
  return Object.freeze({
    [preparedSelectionBrand]: true as const,
    actor: Object.freeze({ ...actor }),
    customTags: Object.freeze(customTags),
    presetTagIds: Object.freeze([...input.presetTagIds]),
    scope,
  });
}

export async function resolveContentTagsInTransaction(
  transaction: TagResolutionTransaction,
  prepared: PreparedContentTagSelection,
): Promise<string[]> {
  if (prepared?.[preparedSelectionBrand] !== true) {
    throw new TagValidationError('INVALID_INPUT');
  }
  requireVerified(prepared.actor);
  const scope = validScope(prepared.scope);
  if (prepared.presetTagIds.length > 5 || prepared.customTags.length > 2) {
    throw new TagValidationError('INVALID_INPUT');
  }
  const presets = prepared.presetTagIds.length
    ? await transaction.tagDefinition.findMany({
        select: {
          campusId: true,
          id: true,
          isActive: true,
          isPreset: true,
          scope: true,
        },
        where: {
          campusId: prepared.actor.campusId,
          id: { in: prepared.presetTagIds },
          isActive: true,
          isPreset: true,
          scope,
        },
      })
    : [];
  if (
    presets.length !== prepared.presetTagIds.length ||
    presets.some((record) => !validPreset(record, prepared.actor, scope)) ||
    presets.some((record) => !prepared.presetTagIds.includes(record.id))
  ) {
    throw new TagValidationError('INVALID_INPUT');
  }

  const ids = presets.map((record) => record.id);
  const missing: Array<{ label: string; slug: string }> = [];
  for (const custom of prepared.customTags) {
    const existing = await transaction.tagDefinition.findUnique({
      where: customTagWhere(prepared.actor, scope, custom.slug),
    });
    if (existing) {
      ids.push(
        validateCustomRecord(existing, prepared.actor, scope, custom.slug).id,
      );
    } else {
      missing.push(custom);
    }
  }
  if (new Set(ids).size + missing.length > 5) {
    throw new TagValidationError('TOO_MANY_TAGS');
  }
  for (const custom of missing) {
    const record = await transaction.tagDefinition.upsert({
      create: {
        campusId: prepared.actor.campusId,
        isActive: true,
        isPreset: false,
        label: custom.label,
        scope,
        slug: custom.slug,
      },
      update: {},
      where: customTagWhere(prepared.actor, scope, custom.slug),
    });
    ids.push(
      validateCustomRecord(record, prepared.actor, scope, custom.slug).id,
    );
  }
  const unique = [...new Set(ids)].sort();
  if (unique.length > 5) throw new TagValidationError('TOO_MANY_TAGS');
  return unique;
}

function isUniqueConflict(error: unknown) {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function isAllowedAssessment(value: unknown) {
  if (value === true) return true;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.allowed === true && Object.keys(record).length === 1;
}

function validPreset(
  record: TagRecord,
  actor: VerifiedTagActor,
  scope: TagScope,
) {
  return (
    record.campusId === actor.campusId &&
    record.scope === scope &&
    record.isPreset === true &&
    record.isActive === true
  );
}

function customTagWhere(
  actor: VerifiedTagActor,
  scope: TagScope,
  slug: string,
) {
  return {
    campusId_scope_slug: { campusId: actor.campusId, scope, slug },
  };
}

function validateCustomRecord(
  record: TagRecord | null,
  actor: VerifiedTagActor,
  scope: TagScope,
  slug: string,
) {
  if (
    !record ||
    record.campusId !== actor.campusId ||
    record.scope !== scope ||
    (record.slug !== undefined && record.slug !== slug)
  ) {
    throw new TagConflictError();
  }
  if (!record.isActive) {
    throw new TagValidationError('INACTIVE_TAG');
  }
  return record;
}

export async function resolveContentTags(
  adapter: TagAdapter,
  actor: VerifiedTagActor,
  scopeValue: TagScope,
  inputValue: TagSelectionInput,
  policy: TagResolutionPolicy = {},
) {
  const prepared = await prepareContentTagSelection(
    actor,
    scopeValue,
    inputValue,
    policy,
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await adapter.$transaction(
        (transaction) => resolveContentTagsInTransaction(transaction, prepared),
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        (isUniqueConflict(error) || isTransactionConflict(error)) &&
        attempt < 2
      ) {
        continue;
      }
      if (isUniqueConflict(error) || isTransactionConflict(error)) {
        throw new TagConflictError();
      }
      throw error;
    }
  }
  throw new TagConflictError();
}

async function serializable<T>(
  adapter: TagAdapter,
  operation: (tx: TagAdapter) => Promise<T>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await adapter.$transaction(operation, {
        isolationLevel: 'Serializable',
      });
    } catch (error) {
      if (error instanceof TagConflictError) throw error;
      if (isTransactionConflict(error) && attempt < 2) continue;
      if (isTransactionConflict(error) || isUniqueConflict(error)) {
        throw new TagConflictError();
      }
      throw error;
    }
  }
  throw new TagConflictError();
}

function scopedIdWhere(actor: TagActor, scope: TagScope, id: string) {
  return {
    id_campusId_scope: { campusId: actor.campusId, id, scope },
  };
}

export async function createPresetTag(
  adapter: TagAdapter,
  actor: TagActor,
  input: { label: string; reason: string; scope: TagScope },
) {
  requireAdmin(actor);
  const scope = validScope(input.scope);
  const label = normalizeTagLabel(input.label);
  const slug = createTagSlug(label);
  const governanceReason = reason(input.reason);
  return serializable(adapter, async (tx) => {
    const where = {
      campusId_scope_slug: { campusId: actor.campusId, scope, slug },
    };
    if (await tx.tagDefinition.findUnique({ where })) {
      throw new TagConflictError();
    }
    const created = await tx.tagDefinition.create({
      data: {
        campusId: actor.campusId,
        isActive: true,
        isPreset: true,
        label,
        scope,
        slug,
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'TAG_CREATED',
        actorId: actor.id,
        campusId: actor.campusId,
        details: {
          reason: governanceReason,
          scope,
          to: 'PRESET_ACTIVE',
        },
        subjectId: created.id,
        subjectType: 'TAG_DEFINITION',
      },
    });
    return managedTag(created);
  });
}

function assertScopedRecord(
  record: TagRecord | null,
  actor: TagActor,
  scope: TagScope,
) {
  if (!record || record.campusId !== actor.campusId || record.scope !== scope) {
    throw new TagConflictError();
  }
  return record;
}

export async function setTagActive(
  adapter: TagAdapter,
  actor: TagActor,
  input: {
    active: boolean;
    reason: string;
    scope: TagScope;
    tagId: string;
  },
) {
  requireAdmin(actor);
  if (typeof input.active !== 'boolean') {
    throw new TagValidationError('INVALID_INPUT');
  }
  const scope = validScope(input.scope);
  const id = tagId(input.tagId);
  const governanceReason = reason(input.reason);
  return serializable(adapter, async (tx) => {
    const current = assertScopedRecord(
      await tx.tagDefinition.findUnique({
        where: scopedIdWhere(actor, scope, id),
      }),
      actor,
      scope,
    );
    if (current.isActive === input.active) throw new TagConflictError();
    const changed = await tx.tagDefinition.updateMany({
      data: { isActive: input.active },
      where: {
        campusId: actor.campusId,
        id,
        isActive: current.isActive,
        scope,
      },
    });
    if (changed.count !== 1) throw new TagConflictError();
    await tx.auditLog.create({
      data: {
        action: 'TAG_STATUS_CHANGED',
        actorId: actor.id,
        campusId: actor.campusId,
        details: {
          from: current.isActive ? 'ACTIVE' : 'INACTIVE',
          reason: governanceReason,
          scope,
          to: input.active ? 'ACTIVE' : 'INACTIVE',
        },
        subjectId: id,
        subjectType: 'TAG_DEFINITION',
      },
    });
    return managedTag({ ...current, isActive: input.active });
  });
}

export async function promoteCustomTag(
  adapter: TagAdapter,
  actor: TagActor,
  input: { reason: string; scope: TagScope; tagId: string },
) {
  requireAdmin(actor);
  const scope = validScope(input.scope);
  const id = tagId(input.tagId);
  const governanceReason = reason(input.reason);
  return serializable(adapter, async (tx) => {
    const current = assertScopedRecord(
      await tx.tagDefinition.findUnique({
        where: scopedIdWhere(actor, scope, id),
      }),
      actor,
      scope,
    );
    if (current.isPreset) throw new TagConflictError();
    const changed = await tx.tagDefinition.updateMany({
      data: { isPreset: true },
      where: {
        campusId: actor.campusId,
        id,
        isActive: current.isActive,
        isPreset: false,
        scope,
      },
    });
    if (changed.count !== 1) throw new TagConflictError();
    await tx.auditLog.create({
      data: {
        action: 'TAG_PROMOTED',
        actorId: actor.id,
        campusId: actor.campusId,
        details: {
          from: 'CUSTOM',
          reason: governanceReason,
          scope,
          to: 'PRESET',
        },
        subjectId: id,
        subjectType: 'TAG_DEFINITION',
      },
    });
    return managedTag({ ...current, isPreset: true });
  });
}
