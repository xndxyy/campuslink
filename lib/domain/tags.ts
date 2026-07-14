import {
  TagValidationError,
  createTagSlug,
  normalizeTagLabel,
  parseTagSelectionInput,
  type TagScope,
  type TagSelectionInput,
} from '@/lib/validation/tags';

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
) {
  requireAdmin(actor);
  const scope = validScope(scopeValue);
  const records = await adapter.tagDefinition.findMany({
    orderBy: [{ label: 'asc' }, { id: 'asc' }],
    select: { id: true, isActive: true, isPreset: true, label: true },
    where: { campusId: actor.campusId, scope },
  });
  return stableTagOrder(records).map(managedTag);
}

type CustomTagAssessment = boolean | { allowed: boolean } | void;

export interface TagResolutionPolicy {
  assessCustomTag?: (label: string) => Promise<CustomTagAssessment>;
}

function isUniqueConflict(error: unknown) {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function isSerializationFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return (
    candidate.code === 'P2034' ||
    candidate.code === '40001' ||
    candidate.meta?.code === '40001'
  );
}

function isAllowedAssessment(value: CustomTagAssessment) {
  if (value === undefined || value === true) return true;
  if (value === false) return false;
  return value.allowed === true;
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

async function resolveCustomTag(
  adapter: TagAdapter,
  actor: VerifiedTagActor,
  scope: TagScope,
  label: string,
) {
  const slug = createTagSlug(label);
  const where = customTagWhere(actor, scope, slug);
  let record: TagRecord | null;
  try {
    record = await adapter.tagDefinition.upsert({
      create: {
        campusId: actor.campusId,
        isActive: true,
        isPreset: false,
        label,
        scope,
        slug,
      },
      update: {},
      where,
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    record = await adapter.tagDefinition.findUnique({ where });
  }
  return validateCustomRecord(record, actor, scope, slug).id;
}

export async function resolveContentTags(
  adapter: TagAdapter,
  actor: VerifiedTagActor,
  scopeValue: TagScope,
  inputValue: TagSelectionInput,
  policy: TagResolutionPolicy = {},
) {
  requireVerified(actor);
  const scope = validScope(scopeValue);
  const input = parseTagSelectionInput(inputValue);
  const presets = input.presetTagIds.length
    ? await adapter.tagDefinition.findMany({
        select: {
          campusId: true,
          id: true,
          isActive: true,
          isPreset: true,
          scope: true,
        },
        where: {
          campusId: actor.campusId,
          id: { in: input.presetTagIds },
          isActive: true,
          isPreset: true,
          scope,
        },
      })
    : [];
  if (
    presets.length !== input.presetTagIds.length ||
    presets.some((record) => !validPreset(record, actor, scope)) ||
    presets.some((record) => !input.presetTagIds.includes(record.id))
  ) {
    throw new TagValidationError('INVALID_INPUT');
  }

  const ids = presets.map((record) => record.id);
  const assess =
    policy.assessCustomTag ?? (async () => ({ allowed: true }) as const);
  const candidates: Array<{
    existingId: string | null;
    label: string;
    slug: string;
  }> = [];
  for (const label of input.customTags) {
    if (!isAllowedAssessment(await assess(label))) {
      throw new TagValidationError('POLICY_REJECTED');
    }
    const slug = createTagSlug(label);
    const existing = await adapter.tagDefinition.findUnique({
      where: customTagWhere(actor, scope, slug),
    });
    candidates.push({
      existingId: existing
        ? validateCustomRecord(existing, actor, scope, slug).id
        : null,
      label,
      slug,
    });
  }
  const existingIds = candidates.flatMap((candidate) =>
    candidate.existingId ? [candidate.existingId] : [],
  );
  const missingCount = candidates.length - existingIds.length;
  if (new Set([...ids, ...existingIds]).size + missingCount > 5) {
    throw new TagValidationError('TOO_MANY_TAGS');
  }
  for (const candidate of candidates) {
    ids.push(await resolveCustomTag(adapter, actor, scope, candidate.label));
  }
  const unique = [...new Set(ids)].sort();
  if (unique.length > 5) throw new TagValidationError('TOO_MANY_TAGS');
  return unique;
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
      if (isSerializationFailure(error) && attempt < 2) continue;
      if (isSerializationFailure(error) || isUniqueConflict(error)) {
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
