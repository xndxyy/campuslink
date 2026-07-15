import {
  normalizeModerationText,
  normalizePlainTextBlockedWord,
} from '@/lib/security/text-normalization';

type Role = 'STUDENT' | 'MODERATOR' | 'ADMIN';

export interface BlockedWordActor {
  campusId: string;
  id: string;
  role: Role;
}
export interface BlockedWordMatch {
  category: string;
  normalized: string;
}
export interface BlockedWordRecord extends BlockedWordMatch {
  id: string;
  original: string;
  enabled: boolean;
}

export interface BlockedWordAdapter {
  $transaction<T>(
    operation: (transaction: BlockedWordAdapter) => Promise<T>,
  ): Promise<T>;
  blockedWord: {
    create(args: Record<string, unknown>): Promise<BlockedWordRecord>;
    findMany(args: Record<string, unknown>): Promise<BlockedWordRecord[]>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
    deleteMany(args: Record<string, unknown>): Promise<{ count: number }>;
  };
  auditLog: { create(args: Record<string, unknown>): Promise<unknown> };
}

const cacheTtlMs = 60_000;
const cache = new Map<
  string,
  { expiresAt: number; words: BlockedWordMatch[] }
>();

export function invalidateBlockedWordCache(campusId: string) {
  cache.delete(campusId);
}

export class BlockedWordForbiddenError extends Error {}
export class BlockedWordValidationError extends Error {}
export class BlockedWordConflictError extends Error {}

function requireAdmin(actor: BlockedWordActor) {
  if (actor.role !== 'ADMIN')
    throw new BlockedWordForbiddenError('Blocked word access is forbidden');
}

function governanceReason(value: string) {
  if (typeof value !== 'string')
    throw new BlockedWordValidationError('Invalid reason');
  const result = value.trim();
  if (result.length < 5 || result.length > 1000)
    throw new BlockedWordValidationError('Invalid reason');
  return result;
}

function category(value: string) {
  if (typeof value !== 'string')
    throw new BlockedWordValidationError('Invalid category');
  const result = value.trim();
  if (!result || result.length > 100)
    throw new BlockedWordValidationError('Invalid category');
  return result;
}

function id(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 191)
    throw new BlockedWordValidationError('Invalid id');
  return value.trim();
}

function isUniqueConflict(error: unknown) {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export function findBlockedWord(
  text: string,
  words: ReadonlyArray<Pick<BlockedWordMatch, 'category' | 'normalized'>>,
): BlockedWordMatch | null {
  const normalizedText = normalizeModerationText(text);
  if (!normalizedText) return null;
  for (const word of words) {
    if (normalizedText.includes(word.normalized))
      return { category: word.category, normalized: word.normalized };
  }
  return null;
}

export async function findBlockedWordForCampus(
  adapter: BlockedWordAdapter,
  campusId: string,
  text: string,
) {
  const now = Date.now();
  let cached = cache.get(campusId);
  if (!cached || cached.expiresAt <= now) {
    const records = await adapter.blockedWord.findMany({
      orderBy: [{ normalized: 'asc' }, { id: 'asc' }],
      select: { category: true, normalized: true },
      take: 1_000,
      where: { campusId, enabled: true },
    });
    cached = {
      expiresAt: now + cacheTtlMs,
      words: records.map(({ category, normalized }) => ({
        category,
        normalized,
      })),
    };
    if (cache.size >= 100) cache.clear();
    cache.set(campusId, cached);
  }
  const match = findBlockedWord(text, cached.words);
  return match
    ? {
        category: match.category,
        message: '内容包含不符合社区规范的词语，请修改后重试。',
      }
    : null;
}

export async function createBlockedWord(
  adapter: BlockedWordAdapter,
  actor: BlockedWordActor,
  input: { category: string; original: string; reason: string },
) {
  requireAdmin(actor);
  let word: { original: string; normalized: string };
  try {
    word = normalizePlainTextBlockedWord(input.original);
  } catch {
    throw new BlockedWordValidationError('Invalid blocked word');
  }
  const wordCategory = category(input.category);
  const reason = governanceReason(input.reason);
  let created: BlockedWordRecord;
  try {
    created = await adapter.$transaction(async (transaction) => {
      const record = await transaction.blockedWord.create({
        data: {
          campusId: actor.campusId,
          category: wordCategory,
          original: word.original,
          normalized: word.normalized,
          reason,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'BLOCKED_WORD_CREATED',
          actorId: actor.id,
          campusId: actor.campusId,
          subjectId: record.id,
          details: { category: record.category, reason },
        },
      });
      return record;
    });
  } catch (error) {
    if (isUniqueConflict(error))
      throw new BlockedWordConflictError('Blocked word state conflict');
    throw error;
  }
  invalidateBlockedWordCache(actor.campusId);
  return created;
}

export async function listBlockedWords(
  adapter: BlockedWordAdapter,
  actor: BlockedWordActor,
) {
  requireAdmin(actor);
  return adapter.blockedWord.findMany({
    where: { campusId: actor.campusId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      original: true,
      normalized: true,
      category: true,
      enabled: true,
    },
  });
}

export async function setBlockedWordEnabled(
  adapter: BlockedWordAdapter,
  actor: BlockedWordActor,
  input: { enabled: boolean; id: string; reason: string },
) {
  requireAdmin(actor);
  if (typeof input.enabled !== 'boolean')
    throw new BlockedWordValidationError('Invalid status');
  const wordId = id(input.id);
  const reason = governanceReason(input.reason);
  await adapter.$transaction(async (transaction) => {
    const result = await transaction.blockedWord.updateMany({
      data: { enabled: input.enabled },
      where: {
        id: wordId,
        campusId: actor.campusId,
        enabled: !input.enabled,
      },
    });
    if (result.count !== 1)
      throw new BlockedWordConflictError('Blocked word state conflict');
    await transaction.auditLog.create({
      data: {
        action: 'BLOCKED_WORD_STATUS_CHANGED',
        actorId: actor.id,
        campusId: actor.campusId,
        subjectId: wordId,
        details: { enabled: input.enabled, reason },
      },
    });
  });
  invalidateBlockedWordCache(actor.campusId);
}

export async function deleteBlockedWord(
  adapter: BlockedWordAdapter,
  actor: BlockedWordActor,
  input: { id: string; reason: string },
) {
  requireAdmin(actor);
  const wordId = id(input.id);
  const reason = governanceReason(input.reason);
  await adapter.$transaction(async (transaction) => {
    const deleted = await transaction.blockedWord.deleteMany({
      where: { id: wordId, campusId: actor.campusId },
    });
    if (deleted.count !== 1)
      throw new BlockedWordConflictError('Blocked word state conflict');
    await transaction.auditLog.create({
      data: {
        action: 'BLOCKED_WORD_DELETED',
        actorId: actor.id,
        campusId: actor.campusId,
        subjectId: wordId,
        details: { reason },
      },
    });
  });
  invalidateBlockedWordCache(actor.campusId);
}
