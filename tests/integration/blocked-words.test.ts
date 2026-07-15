import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDb } from '@/lib/db';
import {
  createBlockedWord,
  deleteBlockedWord,
  setBlockedWordEnabled,
  type BlockedWordAdapter,
} from '@/lib/domain/blocked-words';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('blocked word administration', () => {
  const suffix = randomUUID();
  const campusId = `blocked-campus-${suffix}`;
  const actorId = `blocked-admin-${suffix}`;
  let db: ReturnType<typeof getDb>;
  const actor = { campusId, id: actorId, role: 'ADMIN' as const };

  beforeAll(async () => {
    db = getDb();
    await db.campus.create({
      data: {
        id: campusId,
        name: 'Blocked Word Campus',
        slug: `blocked-${suffix}`,
      },
    });
    await db.user.create({
      data: {
        campusId,
        email: `blocked-${suffix}@example.test`,
        emailVerifiedAt: new Date(),
        id: actorId,
        name: 'Blocked Word Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { campusId } });
    await db.blockedWord.deleteMany({ where: { campusId } });
    await db.user.deleteMany({ where: { campusId } });
    await db.campus.deleteMany({ where: { id: campusId } });
  });

  it('creates, disables, and permanently deletes a word with audit evidence', async () => {
    const adapter = db as unknown as BlockedWordAdapter;
    const created = await createBlockedWord(adapter, actor, {
      category: '诈骗引流',
      original: '违规交易',
      reason: '新增校园诈骗引流治理规则。',
    });
    await setBlockedWordEnabled(adapter, actor, {
      enabled: false,
      id: created.id,
      reason: '临时停用并复核误报范围。',
    });
    await expect(
      db.blockedWord.findUnique({ where: { id: created.id } }),
    ).resolves.toMatchObject({ enabled: false });

    await deleteBlockedWord(adapter, actor, {
      id: created.id,
      reason: '复核完成后永久删除旧规则。',
    });
    await expect(
      db.blockedWord.findUnique({ where: { id: created.id } }),
    ).resolves.toBeNull();
    await expect(
      db.auditLog.findMany({
        orderBy: { createdAt: 'asc' },
        select: { action: true },
        where: { campusId, subjectId: created.id },
      }),
    ).resolves.toEqual([
      { action: 'BLOCKED_WORD_CREATED' },
      { action: 'BLOCKED_WORD_STATUS_CHANGED' },
      { action: 'BLOCKED_WORD_DELETED' },
    ]);
  });
});
