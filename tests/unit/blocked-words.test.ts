import { describe, expect, it, vi } from 'vitest';

import {
  BlockedWordForbiddenError,
  type BlockedWordAdapter,
  BlockedWordConflictError,
  createBlockedWord,
  findBlockedWord,
  findBlockedWordForCampus,
} from '@/lib/domain/blocked-words';
import { normalizeModerationText } from '@/lib/security/text-normalization';

const admin = { campusId: 'campus_1', id: 'admin_1', role: 'ADMIN' as const };

function adapter(
  create: BlockedWordAdapter['blockedWord']['create'],
  audit: BlockedWordAdapter['auditLog']['create'],
) {
  const result: BlockedWordAdapter = {
    $transaction: vi.fn(async (operation) => operation(result)),
    auditLog: { create: audit },
    blockedWord: {
      create,
      deleteMany: async () => ({ count: 0 }),
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
    },
  };
  return result;
}

describe('blocked word moderation', () => {
  it('normalizes NFKC, casing, whitespace, and common separators before matching', () => {
    expect(normalizeModerationText('违 规－交易')).toBe('违规交易');
    expect(
      findBlockedWord('这是违-规 交易信息', [
        { category: '诈骗引流', normalized: '违规交易' },
      ]),
    ).toEqual({
      category: '诈骗引流',
      normalized: '违规交易',
    });
  });

  it('creates only plain-text entries and audits the governance reason', async () => {
    const create = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        enabled: true,
        id: 'word_1',
        ...data,
      }),
    ) as unknown as BlockedWordAdapter['blockedWord']['create'];
    const audit = vi.fn(
      async () => ({}),
    ) as unknown as BlockedWordAdapter['auditLog']['create'];
    const db = adapter(create, audit);
    await expect(
      createBlockedWord(db, admin, {
        category: '诈骗引流',
        original: '违规交易',
        reason: '校园治理规则更新，需要拦截此类内容。',
      }),
    ).resolves.toMatchObject({ id: 'word_1', normalized: '违规交易' });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'BLOCKED_WORD_CREATED',
          subjectId: 'word_1',
        }),
      }),
    );
    expect(create).toHaveBeenCalledOnce();
    expect(db.$transaction).toHaveBeenCalledOnce();
    await expect(
      createBlockedWord(adapter(create, audit), admin, {
        category: '诈骗引流',
        original: '违.*交易',
        reason: '不得把正则表达式放入本地屏蔽词。',
      }),
    ).rejects.toBeInstanceOf(Error);
  });

  it('loads enabled words once per campus and matches from the cache', async () => {
    const db = adapter(
      (async () => ({
        category: '诈骗引流',
        enabled: true,
        id: 'word_1',
        normalized: '违规交易',
        original: '违规交易',
      })) as BlockedWordAdapter['blockedWord']['create'],
      (async () => ({})) as BlockedWordAdapter['auditLog']['create'],
    );
    const findMany = vi.fn(async () => [
      {
        category: '诈骗引流',
        enabled: true,
        id: 'word_1',
        normalized: '违规交易',
        original: '违规交易',
      },
    ]);
    db.blockedWord.findMany = findMany;

    await expect(
      findBlockedWordForCampus(db, 'cache-campus', '违-规 交易'),
    ).resolves.toEqual({
      category: '诈骗引流',
      message: '内容包含不符合社区规范的词语，请修改后重试。',
    });
    await findBlockedWordForCampus(db, 'cache-campus', '普通内容');
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campusId: 'cache-campus', enabled: true },
      }),
    );
  });

  it('rejects non-admin management', async () => {
    await expect(
      createBlockedWord(
        adapter(
          (async () => ({
            enabled: true,
            id: 'word_1',
            category: '诈骗引流',
            normalized: '违规交易',
            original: '违规交易',
          })) as BlockedWordAdapter['blockedWord']['create'],
          (async () => ({})) as BlockedWordAdapter['auditLog']['create'],
        ),
        { ...admin, role: 'STUDENT' },
        {
          category: '诈骗引流',
          original: '违规交易',
          reason: '学生没有治理词库的权限。',
        },
      ),
    ).rejects.toBeInstanceOf(BlockedWordForbiddenError);
  });

  it('maps duplicate normalized entries to a stable conflict', async () => {
    const db = adapter(
      (async () => {
        throw { code: 'P2002' };
      }) as BlockedWordAdapter['blockedWord']['create'],
      (async () => ({})) as BlockedWordAdapter['auditLog']['create'],
    );
    await expect(
      createBlockedWord(db, admin, {
        category: '诈骗引流',
        original: '违规交易',
        reason: '重复规则应返回稳定冲突。',
      }),
    ).rejects.toBeInstanceOf(BlockedWordConflictError);
  });
});
