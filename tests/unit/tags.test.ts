import { describe, expect, it, vi } from 'vitest';

import {
  TagConflictError,
  TagForbiddenError,
  createPresetTag,
  encodeManagedTagCursor,
  listAvailableTags,
  listManagedTags,
  parseManagedTagQuery,
  prepareContentTagSelection,
  promoteCustomTag,
  resolveContentTags,
  resolveContentTagsInTransaction,
  setTagActive,
  type TagAdapter,
  type TagRecord,
  type TagResolutionPolicy,
} from '@/lib/domain/tags';
import { TagValidationError } from '@/lib/validation/tags';

const actor = {
  campusId: 'campus_1',
  emailVerifiedAt: new Date('2026-07-01T00:00:00Z'),
  id: 'student_1',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};
const admin = { ...actor, id: 'admin_1', role: 'ADMIN' as const };

const missingReturnPolicy: TagResolutionPolicy = {
  // @ts-expect-error A policy callback must return an explicit decision.
  assessCustomTag: async () => {},
};
void missingReturnPolicy;

function tagRecord(overrides: Partial<TagRecord> = {}): TagRecord {
  return {
    campusId: actor.campusId,
    id: 'tag_1',
    isActive: true,
    isPreset: true,
    label: '课程',
    scope: 'RESOURCE',
    ...overrides,
  };
}

function isolatedResolutionAdapter(afterAttemptErrors: string[] = []) {
  const rootSpies = adapter();
  const transaction = adapter();
  const transactionSpy = vi.fn();
  const errors = [...afterAttemptErrors];
  const root: TagAdapter = {
    auditLog: rootSpies.auditLog,
    tagDefinition: rootSpies.tagDefinition,
    $transaction: async <T>(
      operation: (tx: TagAdapter) => Promise<T>,
      options?: { isolationLevel: 'Serializable' },
    ) => {
      transactionSpy(operation, options);
      const result = await operation(transaction);
      const code = errors.shift();
      if (code) throw { code };
      return result;
    },
  };
  return { root, rootSpies, transaction, transactionSpy };
}

function adapter() {
  const transactionSpy = vi.fn();
  const auditCreate = vi.fn<TagAdapter['auditLog']['create']>(
    async ({ data }) => data as Record<string, unknown>,
  );
  const tagCreate = vi.fn<TagAdapter['tagDefinition']['create']>(
    async ({ data }) =>
      ({
        id: 'tag_created',
        ...(data as Record<string, unknown>),
      }) as unknown as TagRecord,
  );
  const findMany = vi.fn<TagAdapter['tagDefinition']['findMany']>(async () =>
    Promise.resolve([]),
  );
  const findUnique = vi.fn<TagAdapter['tagDefinition']['findUnique']>(
    async () => Promise.resolve(null),
  );
  const updateMany = vi.fn<TagAdapter['tagDefinition']['updateMany']>(
    async () => ({ count: 1 }),
  );
  const upsert = vi.fn<TagAdapter['tagDefinition']['upsert']>(
    async ({ create }) =>
      ({
        id: 'tag_custom',
        ...(create as Record<string, unknown>),
      }) as unknown as TagRecord,
  );
  const service: { current?: TagAdapter } = {};
  async function transaction<T>(
    operation: (tx: TagAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T> {
    transactionSpy(operation, options);
    if (!service.current) throw new Error('test adapter is not initialized');
    return operation(service.current);
  }
  const db = {
    $transaction: transaction,
    auditLog: { create: auditCreate },
    tagDefinition: {
      create: tagCreate,
      findMany,
      findUnique,
      updateMany,
      upsert,
    },
    transactionSpy,
  };
  service.current = db;
  return db;
}

describe('tag domain API', () => {
  it('exposes scoped selection and administrator governance operations', async () => {
    const domain = await import('@/lib/domain/tags').catch(() => ({}));

    expect(domain).toMatchObject({
      createPresetTag: expect.any(Function),
      encodeManagedTagCursor: expect.any(Function),
      listAvailableTags: expect.any(Function),
      listManagedTags: expect.any(Function),
      parseManagedTagQuery: expect.any(Function),
      promoteCustomTag: expect.any(Function),
      prepareContentTagSelection: expect.any(Function),
      resolveContentTags: expect.any(Function),
      resolveContentTagsInTransaction: expect.any(Function),
      setTagActive: expect.any(Function),
    });
  });
});

describe('scoped available tags', () => {
  it('returns only a stable minimal DTO and queries active presets in actor campus', async () => {
    const db = adapter();
    db.tagDefinition.findMany.mockResolvedValue([
      {
        campusId: actor.campusId,
        id: 'tag_b',
        isActive: true,
        isPreset: true,
        label: '编程',
        scope: 'RESOURCE',
        secret: 'not returned',
      },
      {
        campusId: actor.campusId,
        id: 'tag_a',
        isActive: true,
        isPreset: true,
        label: '编程',
        scope: 'RESOURCE',
      },
    ]);

    await expect(listAvailableTags(db, actor, 'RESOURCE')).resolves.toEqual([
      { id: 'tag_a', label: '编程' },
      { id: 'tag_b', label: '编程' },
    ]);
    expect(db.tagDefinition.findMany).toHaveBeenCalledWith({
      orderBy: [{ label: 'asc' }, { id: 'asc' }],
      select: { id: true, label: true },
      take: 100,
      where: {
        campusId: actor.campusId,
        isActive: true,
        isPreset: true,
        scope: 'RESOURCE',
      },
    });
  });

  it('requires an active verified actor for ordinary selection', async () => {
    const db = adapter();
    for (const invalid of [
      { ...actor, emailVerifiedAt: null },
      { ...actor, status: 'SUSPENDED' },
    ]) {
      await expect(
        listAvailableTags(db, invalid as typeof actor, 'RESOURCE'),
      ).rejects.toBeInstanceOf(TagForbiddenError);
    }
    expect(db.tagDefinition.findMany).not.toHaveBeenCalled();
  });

  it('lets only administrators list a bounded first page of all definitions', async () => {
    const db = adapter();
    await expect(
      listManagedTags(db, actor, 'MARKETPLACE'),
    ).rejects.toBeInstanceOf(TagForbiddenError);
    db.tagDefinition.findMany.mockResolvedValue([
      tagRecord({ id: 'tag_a', label: '编程', scope: 'MARKETPLACE' }),
      tagRecord({
        id: 'tag_b',
        isActive: false,
        isPreset: false,
        label: '编程',
        scope: 'MARKETPLACE',
      }),
      tagRecord({ id: 'tag_c', label: '设计', scope: 'MARKETPLACE' }),
    ]);
    const page = await listManagedTags(db, admin, 'MARKETPLACE', {
      pageSize: 2,
    });
    expect(page).toEqual({
      hasNextPage: true,
      items: [
        { id: 'tag_a', isActive: true, isPreset: true, label: '编程' },
        { id: 'tag_b', isActive: false, isPreset: false, label: '编程' },
      ],
      nextCursor: encodeManagedTagCursor({ id: 'tag_b', label: '编程' }),
    });
    expect(db.tagDefinition.findMany).toHaveBeenCalledWith({
      orderBy: [{ label: 'asc' }, { id: 'asc' }],
      select: { id: true, isActive: true, isPreset: true, label: true },
      take: 3,
      where: { campusId: admin.campusId, scope: 'MARKETPLACE' },
    });
  });

  it('uses an opaque label/id cursor without repeating the prior boundary', async () => {
    const db = adapter();
    const cursor = { id: 'tag_b', label: '编程' };
    db.tagDefinition.findMany.mockResolvedValue([
      tagRecord({ id: 'tag_c', label: '编程' }),
      tagRecord({ id: 'tag_d', label: '设计' }),
    ]);

    await expect(
      listManagedTags(db, admin, 'RESOURCE', { cursor, pageSize: 2 }),
    ).resolves.toEqual({
      hasNextPage: false,
      items: [
        { id: 'tag_c', isActive: true, isPreset: true, label: '编程' },
        { id: 'tag_d', isActive: true, isPreset: true, label: '设计' },
      ],
      nextCursor: null,
    });
    expect(db.tagDefinition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        where: {
          campusId: admin.campusId,
          OR: [
            { label: { gt: '编程' } },
            { id: { gt: 'tag_b' }, label: '编程' },
          ],
          scope: 'RESOURCE',
        },
      }),
    );
  });

  it('parses only canonical bounded managed tag query fields', () => {
    const cursor = encodeManagedTagCursor({ id: 'tag_b', label: '编程' });
    expect(
      parseManagedTagQuery(
        new URLSearchParams(
          `scope=RESOURCE&pageSize=2&cursor=${encodeURIComponent(cursor)}`,
        ),
      ),
    ).toEqual({
      query: { cursor: { id: 'tag_b', label: '编程' }, pageSize: 2 },
      scope: 'RESOURCE',
    });
    expect(
      parseManagedTagQuery(new URLSearchParams('scope=MARKETPLACE')),
    ).toEqual({ query: { pageSize: 50 }, scope: 'MARKETPLACE' });

    for (const query of [
      '',
      'scope=RESOURCE&scope=MARKETPLACE',
      'scope=INVALID',
      'scope=RESOURCE&pageSize=0',
      'scope=RESOURCE&pageSize=101',
      'scope=RESOURCE&pageSize=1.5',
      'scope=RESOURCE&cursor=not-base64-json',
      `scope=RESOURCE&cursor=${encodeURIComponent(`${cursor}=`)}`,
      'scope=RESOURCE&unknown=1',
      'scope=RESOURCE&pageSize=2&pageSize=3',
    ]) {
      expect(() => parseManagedTagQuery(new URLSearchParams(query))).toThrow(
        TagValidationError,
      );
    }
  });
});

describe('tag selection resolution', () => {
  it.each<Partial<TagRecord>>([
    { campusId: 'campus_2' },
    { scope: 'MARKETPLACE' },
    { isActive: false },
    { isPreset: false },
  ])('rejects a preset record that violates %o', async (override) => {
    const db = adapter();
    db.tagDefinition.findMany.mockResolvedValue([
      {
        campusId: actor.campusId,
        id: 'preset_1',
        isActive: true,
        isPreset: true,
        label: '课程',
        scope: 'RESOURCE',
        ...override,
      },
    ]);
    await expect(
      resolveContentTags(db, actor, 'RESOURCE', {
        customTags: [],
        presetTagIds: ['preset_1'],
      }),
    ).rejects.toBeInstanceOf(TagValidationError);
  });

  it('requires an exact preset result count and rejects inactive custom definitions', async () => {
    const missing = adapter();
    await expect(
      resolveContentTags(missing, actor, 'RESOURCE', {
        customTags: [],
        presetTagIds: ['missing'],
      }),
    ).rejects.toBeInstanceOf(TagValidationError);

    const inactive = adapter();
    inactive.tagDefinition.upsert.mockResolvedValue({
      campusId: actor.campusId,
      id: 'inactive_1',
      isActive: false,
      isPreset: false,
      label: '算法',
      scope: 'RESOURCE',
      slug: '算法',
    });
    await expect(
      resolveContentTags(inactive, actor, 'RESOURCE', {
        customTags: ['算法'],
        presetTagIds: [],
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'INACTIVE_TAG' }));
  });

  it('reuses an active definition after an upsert race and invokes the policy with normalized text', async () => {
    const db = adapter();
    db.tagDefinition.upsert.mockRejectedValueOnce({ code: 'P2002' });
    db.tagDefinition.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        campusId: actor.campusId,
        id: 'custom_1',
        isActive: true,
        isPreset: false,
        label: 'COS 委托',
        scope: 'RESOURCE',
        slug: 'cos-委托',
      });
    const assessCustomTag = vi.fn(async () => ({ allowed: true }));

    await expect(
      resolveContentTags(
        db,
        actor,
        'RESOURCE',
        { customTags: ['  ＣＯＳ   委托 '], presetTagIds: [] },
        { assessCustomTag },
      ),
    ).resolves.toEqual(['custom_1']);
    expect(assessCustomTag).toHaveBeenCalledWith('COS 委托');
    expect(db.tagDefinition.findUnique).toHaveBeenCalledWith({
      where: {
        campusId_scope_slug: {
          campusId: actor.campusId,
          scope: 'RESOURCE',
          slug: 'cos-委托',
        },
      },
    });
  });

  it('rejects policy denials before persistence and enforces five final unique IDs', async () => {
    const denied = adapter();
    await expect(
      resolveContentTags(
        denied,
        actor,
        'RESOURCE',
        { customTags: ['校外推广'], presetTagIds: [] },
        { assessCustomTag: async () => ({ allowed: false }) },
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'POLICY_REJECTED' }),
    );
    expect(denied.tagDefinition.upsert).not.toHaveBeenCalled();

    const tooMany = adapter();
    tooMany.tagDefinition.findMany.mockResolvedValue(
      ['1', '2', '3', '4', '5'].map((id) => ({
        campusId: actor.campusId,
        id,
        isActive: true,
        isPreset: true,
        label: id,
        scope: 'RESOURCE',
      })),
    );
    await expect(
      resolveContentTags(tooMany, actor, 'RESOURCE', {
        customTags: ['新标签'],
        presetTagIds: ['1', '2', '3', '4', '5'],
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'TOO_MANY_TAGS' }));
    expect(tooMany.tagDefinition.upsert).not.toHaveBeenCalled();
  });

  it('reuses a custom label that collides with an active preset and returns sorted IDs', async () => {
    const db = adapter();
    db.tagDefinition.findMany.mockResolvedValue([
      {
        campusId: actor.campusId,
        id: 'z_preset',
        isActive: true,
        isPreset: true,
        label: '算法',
        scope: 'RESOURCE',
      },
    ]);
    db.tagDefinition.upsert.mockResolvedValue({
      campusId: actor.campusId,
      id: 'z_preset',
      isActive: true,
      isPreset: true,
      label: '算法',
      scope: 'RESOURCE',
      slug: '算法',
    });
    await expect(
      resolveContentTags(db, actor, 'RESOURCE', {
        customTags: ['算法'],
        presetTagIds: ['z_preset'],
      }),
    ).resolves.toEqual(['z_preset']);
  });
});

describe('atomic tag selection resolution', () => {
  it('prepares policy and normalization before a Serializable root transaction', async () => {
    const db = isolatedResolutionAdapter();
    const order: string[] = [];
    db.transaction.tagDefinition.findUnique.mockResolvedValue(null);
    db.transaction.tagDefinition.upsert.mockImplementation(
      async ({ create }) => {
        const data = create as Record<string, unknown>;
        return tagRecord({
          id: `tag_${String(data.slug)}`,
          isPreset: false,
          label: String(data.label),
          slug: String(data.slug),
        });
      },
    );
    const assessCustomTag = vi.fn(async (label: string) => {
      order.push(`policy:${label}`);
      return { allowed: true };
    });
    db.transactionSpy.mockImplementation(() => order.push('transaction'));

    await expect(
      resolveContentTags(
        db.root,
        actor,
        'RESOURCE',
        { customTags: ['  ＣＯＳ   委托 ', '算法'], presetTagIds: [] },
        { assessCustomTag },
      ),
    ).resolves.toEqual(['tag_cos-委托', 'tag_算法']);
    expect(order).toEqual(['policy:COS 委托', 'policy:算法', 'transaction']);
    expect(db.transactionSpy).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(db.rootSpies.tagDefinition.findMany).not.toHaveBeenCalled();
    expect(db.rootSpies.tagDefinition.findUnique).not.toHaveBeenCalled();
    expect(db.rootSpies.tagDefinition.upsert).not.toHaveBeenCalled();
  });

  it('resolves a prepared selection in a caller transaction without nesting', async () => {
    const tx = adapter();
    tx.tagDefinition.findUnique.mockResolvedValue(null);
    tx.tagDefinition.upsert.mockResolvedValue(
      tagRecord({
        id: 'custom_1',
        isPreset: false,
        label: 'COS 委托',
        slug: 'cos-委托',
      }),
    );
    const prepared = await prepareContentTagSelection(
      actor,
      'RESOURCE',
      { customTags: ['  ＣＯＳ   委托 '], presetTagIds: [] },
      { assessCustomTag: async () => ({ allowed: true }) },
    );

    await expect(
      resolveContentTagsInTransaction(tx, prepared),
    ).resolves.toEqual(['custom_1']);
    expect(tx.transactionSpy).not.toHaveBeenCalled();
  });

  it('rejects policy before opening a transaction or touching delegates', async () => {
    const db = isolatedResolutionAdapter();
    await expect(
      resolveContentTags(
        db.root,
        actor,
        'RESOURCE',
        { customTags: ['校外推广'], presetTagIds: [] },
        { assessCustomTag: async () => ({ allowed: false }) },
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: 'POLICY_REJECTED' }),
    );
    expect(db.transactionSpy).not.toHaveBeenCalled();
    expect(db.rootSpies.tagDefinition.findUnique).not.toHaveBeenCalled();
    expect(db.transaction.tagDefinition.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', async () => undefined],
    ['null', async () => null],
    ['malformed allow object', async () => ({ allowed: true, extra: 'x' })],
    ['false', async () => false],
    [
      'throw',
      async () => {
        throw new Error('private policy failure');
      },
    ],
  ])(
    'fails closed for %s policy decisions before DB work',
    async (_name, callback) => {
      const db = isolatedResolutionAdapter();
      const assessCustomTag = vi.fn(callback) as unknown as NonNullable<
        TagResolutionPolicy['assessCustomTag']
      >;

      await expect(
        resolveContentTags(
          db.root,
          actor,
          'RESOURCE',
          { customTags: ['算法'], presetTagIds: [] },
          { assessCustomTag },
        ),
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'POLICY_REJECTED' }),
      );
      expect(assessCustomTag).toHaveBeenCalledTimes(1);
      expect(db.transactionSpy).not.toHaveBeenCalled();
      expect(db.rootSpies.tagDefinition.upsert).not.toHaveBeenCalled();
      expect(db.transaction.tagDefinition.upsert).not.toHaveBeenCalled();
    },
  );

  it.each([true, { allowed: true }] as const)(
    'accepts one explicit allow decision %o before the transaction',
    async (decision) => {
      const db = isolatedResolutionAdapter();
      db.transaction.tagDefinition.findUnique.mockResolvedValue(null);
      db.transaction.tagDefinition.upsert.mockResolvedValue(
        tagRecord({
          id: 'custom_1',
          isPreset: false,
          label: '算法',
          slug: '算法',
        }),
      );
      const assessCustomTag = vi.fn(async () => decision);

      await expect(
        resolveContentTags(
          db.root,
          actor,
          'RESOURCE',
          { customTags: ['算法'], presetTagIds: [] },
          { assessCustomTag },
        ),
      ).resolves.toEqual(['custom_1']);
      expect(assessCustomTag).toHaveBeenCalledTimes(1);
      expect(db.transactionSpy).toHaveBeenCalledTimes(1);
    },
  );

  it('retries the whole transaction after P2002 without querying an aborted transaction', async () => {
    const db = isolatedResolutionAdapter();
    db.transaction.tagDefinition.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        tagRecord({
          id: 'custom_raced',
          isPreset: false,
          label: '算法',
          slug: '算法',
        }),
      );
    db.transaction.tagDefinition.upsert.mockRejectedValueOnce({
      code: 'P2002',
    });

    await expect(
      resolveContentTags(db.root, actor, 'RESOURCE', {
        customTags: ['算法'],
        presetTagIds: [],
      }),
    ).resolves.toEqual(['custom_raced']);
    expect(db.transactionSpy).toHaveBeenCalledTimes(2);
    expect(db.transaction.tagDefinition.findUnique).toHaveBeenCalledTimes(2);
    expect(db.transaction.tagDefinition.upsert).toHaveBeenCalledTimes(1);
  });

  it('retries P2034 at most three times and rereads presets each time', async () => {
    const db = isolatedResolutionAdapter(['P2034', 'P2034', 'P2034']);
    db.transaction.tagDefinition.findMany.mockResolvedValue([
      tagRecord({ id: 'preset_1' }),
    ]);

    await expect(
      resolveContentTags(db.root, actor, 'RESOURCE', {
        customTags: [],
        presetTagIds: ['preset_1'],
      }),
    ).rejects.toBeInstanceOf(TagConflictError);
    expect(db.transactionSpy).toHaveBeenCalledTimes(3);
    expect(db.transaction.tagDefinition.findMany).toHaveBeenCalledTimes(3);
  });

  it('rolls back the first custom when a second custom resolves inactive', async () => {
    const tx = adapter();
    const rootSpies = adapter();
    const committed: string[] = [];
    let staged: string[] = [];
    tx.tagDefinition.findUnique.mockResolvedValue(null);
    tx.tagDefinition.upsert.mockImplementation(async ({ create }) => {
      const data = create as Record<string, unknown>;
      const label = String(data.label);
      staged.push(label);
      return tagRecord({
        id: `tag_${label}`,
        isActive: label !== '失效标签',
        isPreset: false,
        label,
        slug: String(data.slug),
      });
    });
    const root: TagAdapter = {
      auditLog: rootSpies.auditLog,
      tagDefinition: rootSpies.tagDefinition,
      $transaction: async <T>(operation: (store: TagAdapter) => Promise<T>) => {
        staged = [];
        try {
          const result = await operation(tx);
          committed.push(...staged);
          return result;
        } catch (error) {
          staged = [];
          throw error;
        }
      },
    };

    await expect(
      resolveContentTags(root, actor, 'RESOURCE', {
        customTags: ['正常标签', '失效标签'],
        presetTagIds: [],
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'INACTIVE_TAG' }));
    expect(committed).toEqual([]);
    expect(rootSpies.tagDefinition.upsert).not.toHaveBeenCalled();
  });
});

describe('administrator tag governance', () => {
  it('requires ADMIN and a trimmed reason from 5 to 1000 characters', async () => {
    const db = adapter();
    await expect(
      createPresetTag(db, actor, {
        label: '课程',
        reason: 'Policy reason',
        scope: 'RESOURCE',
      }),
    ).rejects.toBeInstanceOf(TagForbiddenError);
    await expect(
      createPresetTag(db, admin, {
        label: '课程',
        reason: ' no ',
        scope: 'RESOURCE',
      }),
    ).rejects.toBeInstanceOf(TagValidationError);
  });

  it('creates a new preset serializably and writes only minimal governance audit details', async () => {
    const db = adapter();
    await expect(
      createPresetTag(db, admin, {
        label: '  ＣＯＳ   委托 ',
        reason: '  Campus preset policy.  ',
        scope: 'RESOURCE',
      }),
    ).resolves.toMatchObject({
      id: 'tag_created',
      isActive: true,
      isPreset: true,
      label: 'COS 委托',
    });
    expect(db.transactionSpy).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'TAG_CREATED',
        actorId: admin.id,
        campusId: admin.campusId,
        details: {
          reason: 'Campus preset policy.',
          scope: 'RESOURCE',
          to: 'PRESET_ACTIVE',
        },
        subjectId: 'tag_created',
        subjectType: 'TAG_DEFINITION',
      },
    });
    expect(JSON.stringify(db.auditLog.create.mock.calls)).not.toContain(
      'COS 委托',
    );
  });

  it('does not let create bypass promotion when a custom or preset slug exists', async () => {
    const db = adapter();
    db.tagDefinition.findUnique.mockResolvedValue(
      tagRecord({ id: 'existing' }),
    );
    await expect(
      createPresetTag(db, admin, {
        label: '算法',
        reason: 'Existing definitions use promotion.',
        scope: 'RESOURCE',
      }),
    ).rejects.toBeInstanceOf(TagConflictError);
    expect(db.tagDefinition.create).not.toHaveBeenCalled();
  });

  it('rejects active no-ops and loses an exact status CAS without auditing', async () => {
    const noop = adapter();
    noop.tagDefinition.findUnique.mockResolvedValue({
      campusId: admin.campusId,
      id: 'tag_1',
      isActive: true,
      isPreset: true,
      label: '课程',
      scope: 'RESOURCE',
    });
    await expect(
      setTagActive(noop, admin, {
        active: true,
        reason: 'No-op status is forbidden.',
        scope: 'RESOURCE',
        tagId: 'tag_1',
      }),
    ).rejects.toBeInstanceOf(TagConflictError);
    expect(noop.auditLog.create).not.toHaveBeenCalled();

    const race = adapter();
    race.tagDefinition.findUnique.mockResolvedValue({
      campusId: admin.campusId,
      id: 'tag_1',
      isActive: true,
      isPreset: true,
      label: '课程',
      scope: 'RESOURCE',
    });
    race.tagDefinition.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      setTagActive(race, admin, {
        active: false,
        reason: 'Disable after campus review.',
        scope: 'RESOURCE',
        tagId: 'tag_1',
      }),
    ).rejects.toBeInstanceOf(TagConflictError);
    expect(race.auditLog.create).not.toHaveBeenCalled();
  });

  it('changes active state with CAS and minimal audit details', async () => {
    const db = adapter();
    db.tagDefinition.findUnique.mockResolvedValue({
      campusId: admin.campusId,
      id: 'tag_1',
      isActive: true,
      isPreset: true,
      label: '课程',
      scope: 'RESOURCE',
    });
    await setTagActive(db, admin, {
      active: false,
      reason: 'Disable after campus review.',
      scope: 'RESOURCE',
      tagId: 'tag_1',
    });
    expect(db.tagDefinition.updateMany).toHaveBeenCalledWith({
      data: { isActive: false },
      where: {
        campusId: admin.campusId,
        id: 'tag_1',
        isActive: true,
        scope: 'RESOURCE',
      },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TAG_STATUS_CHANGED',
          details: {
            from: 'ACTIVE',
            reason: 'Disable after campus review.',
            scope: 'RESOURCE',
            to: 'INACTIVE',
          },
        }),
      }),
    );
  });

  it('promotes only custom tags with CAS while preserving inactive state', async () => {
    const db = adapter();
    db.tagDefinition.findUnique.mockResolvedValue({
      campusId: admin.campusId,
      id: 'tag_1',
      isActive: false,
      isPreset: false,
      label: '课程',
      scope: 'RESOURCE',
    });
    await expect(
      promoteCustomTag(db, admin, {
        reason: 'Promote a frequently reused label.',
        scope: 'RESOURCE',
        tagId: 'tag_1',
      }),
    ).resolves.toMatchObject({ id: 'tag_1', isActive: false, isPreset: true });
    expect(db.tagDefinition.updateMany).toHaveBeenCalledWith({
      data: { isPreset: true },
      where: {
        campusId: admin.campusId,
        id: 'tag_1',
        isActive: false,
        isPreset: false,
        scope: 'RESOURCE',
      },
    });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'TAG_PROMOTED',
          details: {
            from: 'CUSTOM',
            reason: 'Promote a frequently reused label.',
            scope: 'RESOURCE',
            to: 'PRESET',
          },
        }),
      }),
    );

    const preset = adapter();
    preset.tagDefinition.findUnique.mockResolvedValue({
      campusId: admin.campusId,
      id: 'tag_2',
      isActive: true,
      isPreset: true,
      label: '预设',
      scope: 'RESOURCE',
    });
    await expect(
      promoteCustomTag(preset, admin, {
        reason: 'Already preset must conflict.',
        scope: 'RESOURCE',
        tagId: 'tag_2',
      }),
    ).rejects.toBeInstanceOf(TagConflictError);
  });
});
