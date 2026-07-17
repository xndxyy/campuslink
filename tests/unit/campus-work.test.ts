import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import * as contentService from '@/lib/domain/content-service';
import { handleContentAction } from '@/lib/domain/content-action-route';
import type { PreparedAssessmentBatch } from '@/lib/moderation/content-assessment';
import * as contentValidation from '@/lib/validation/content';

function readSource(relativePath: string) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('campus work validation', () => {
  it('accepts only campus-work fields and structured tag arrays', () => {
    const schema = (
      contentValidation as unknown as {
        createCampusWorkSchema?: {
          safeParse(value: unknown): { success: boolean };
        };
      }
    ).createCampusWorkSchema;

    expect(schema).toBeDefined();
    if (!schema) return;

    expect(
      schema.safeParse({
        contact: 'student@example.edu',
        customTags: ['晚间'],
        description: '协助整理校园活动物料，并在结束后完成现场归还。',
        location: '学生中心一楼',
        payText: '每小时 30 元',
        presetTagIds: ['preset_campus_work'],
        title: '校园活动现场协助',
      }).success,
    ).toBe(true);
  });

  it.each(['authorId', 'campusId', 'company', 'status'])(
    'rejects client-controlled %s',
    (key) => {
      const schema = (
        contentValidation as unknown as {
          createCampusWorkSchema?: {
            safeParse(value: unknown): { success: boolean };
          };
        }
      ).createCampusWorkSchema;

      expect(schema).toBeDefined();
      if (!schema) return;

      expect(
        schema.safeParse({
          contact: 'student@example.edu',
          customTags: [],
          description: '协助整理校园活动物料，并在结束后完成现场归还。',
          location: '学生中心一楼',
          payText: '每小时 30 元',
          presetTagIds: [],
          title: '校园活动现场协助',
          [key]: 'client-controlled',
        }).success,
      ).toBe(false);
    },
  );
});

describe('campus work route and UI contracts', () => {
  const createRoute = readSource('../../app/api/campus-work/route.ts');
  const actionRoute = readSource('../../app/api/campus-work/[id]/route.ts');
  const contactRoute = readSource(
    '../../app/api/campus-work/[id]/contact/route.ts',
  );
  const listPage = readSource('../../app/campus-work/page.tsx');
  const detailPage = readSource('../../app/campus-work/[id]/page.tsx');
  const submitPage = readSource('../../app/submit/campus-work/page.tsx');
  const jobsPage = readSource('../../app/jobs/page.tsx');
  const jobDetailPage = readSource('../../app/jobs/[id]/page.tsx');
  const submitJobPage = readSource('../../app/submit/job/page.tsx');
  const submissionForm = readSource(
    '../../components/content/submission-form.tsx',
  );
  const editForm = readSource('../../components/content/edit-content-form.tsx');
  const editPage = readSource(
    '../../app/me/submissions/[kind]/[id]/edit/page.tsx',
  );
  const publicPresenter = readSource('../../lib/domain/content-service.ts');

  it('provides first-class public, submit, create, action, and contact routes', () => {
    for (const source of [
      createRoute,
      actionRoute,
      contactRoute,
      listPage,
      detailPage,
      submitPage,
    ]) {
      expect(source.length).toBeGreaterThan(0);
    }
    expect(createRoute).toContain('createCampusWorkPost');
    expect(actionRoute).toContain("'campus-work'");
    expect(contactRoute).toContain("dynamic = 'force-dynamic'");
  });

  it('permanently redirects every legacy job page while retaining the id', () => {
    for (const source of [jobsPage, jobDetailPage, submitJobPage]) {
      expect(source).toContain('permanentRedirect');
    }
    expect(jobsPage).toContain("'/campus-work'");
    expect(jobDetailPage).toContain('`/campus-work/${id}`');
    expect(submitJobPage).toContain("'/submit/campus-work'");
  });

  it('uses the reusable tag selector without requiring a company', () => {
    expect(submitPage).toContain("'CAMPUS_WORK'");
    expect(submitPage).toContain('availableTags={availableTags}');
    expect(submissionForm).toMatch(
      /type FormKind\s*=\s*[^;]*'campus-work'[^;]*;/,
    );
    expect(submissionForm).toContain('<TagSelector');
    expect(submissionForm).not.toMatch(
      /kind === ['"]campus-work['"][\s\S]{0,1000}name=['"]company['"]/,
    );
  });

  it('keeps legacy job semantics out of every user-facing form and URL', () => {
    for (const source of [submissionForm, editForm]) {
      expect(source).not.toContain('name="company"');
      expect(source).not.toContain("'job'");
    }
    expect(
      readSource('../../components/content/public-list.tsx'),
    ).not.toContain("'/jobs'");
    expect(
      readSource('../../components/content/public-detail.tsx'),
    ).not.toContain("'/jobs'");
    expect(editPage).toContain('permanentRedirect');
    expect(editPage).toContain('`/me/submissions/campus-work/${id}/edit`');
  });

  it('shows all three safety warnings near publishing and contact reveal', () => {
    for (const warning of [
      '建议在公共场所见面',
      '不要提前付款',
      '平台不提供资金托管或担保',
    ]) {
      expect(submitPage).toContain(warning);
      expect(
        readSource('../../components/content/public-detail.tsx'),
      ).toContain(warning);
    }
  });

  it('keeps contact out of the campus-work public select', () => {
    expect(publicPresenter).toContain("kind === 'campus-work'");
    expect(publicPresenter).toContain(
      'Contact is deliberately absent from the public campus-work presenter',
    );
  });
});

describe('campus work publishing E2E source', () => {
  const source = readSource('../e2e/publish-content.spec.ts');

  it('publishes campus work through the new route and TagSelector controls', () => {
    expect(source).toContain("page.goto('/submit/campus-work')");
    expect(source).toContain('自定义标签 1');
    expect(source).toContain('textarea[name="contact"]');
    expect(source).not.toContain("page.goto('/submit/job')");
    expect(source).not.toContain('input[name="company"]');
    expect(source).not.toContain('input[name="tags"]');
  });
});

const verifiedActor = {
  campusId: 'campus_1',
  emailVerifiedAt: new Date('2026-07-14T00:00:00Z'),
  id: 'owner_1',
  role: 'STUDENT' as const,
  status: 'ACTIVE' as const,
};

const campusWorkInput = {
  contact: 'owner@example.edu',
  customTags: [],
  description: '协助整理校园活动物料，并在结束后完成现场归还。',
  location: '学生中心一楼',
  payText: '每小时 30 元',
  presetTagIds: ['preset_work'],
  title: '校园活动现场协助',
};

function campusWorkAdapter() {
  const callOrder: string[] = [];
  const createdAt = new Date('2026-07-14T01:00:00Z');
  const updatedAt = new Date('2026-07-14T01:00:00Z');
  const campusWorkPost = {
    count: vi.fn(async () => 1),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      callOrder.push('campusWorkPost.create');
      return {
        id: 'work_1',
        ...data,
        createdAt,
        updatedAt,
      };
    }),
    findFirst: vi.fn(async (args: Record<string, unknown>) => {
      void args;
      return null as Record<string, unknown> | null;
    }),
    findMany: vi.fn(async (args: Record<string, unknown>) => {
      void args;
      return [] as Array<Record<string, unknown>>;
    }),
    update: vi.fn(
      async ({
        data,
        where,
      }: {
        data: Record<string, unknown>;
        where: { id: string };
      }) => {
        callOrder.push('campusWorkPost.update');
        return { ...data, id: where.id };
      },
    ),
    updateMany: vi.fn(
      async (args: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        callOrder.push('campusWorkPost.updateMany');
        void args;
        return { count: 1 };
      },
    ),
  };
  const campusWorkTag = {
    createMany: vi.fn(
      async ({ data }: { data: Array<Record<string, unknown>> }) => ({
        count: data.length,
      }),
    ),
    deleteMany: vi.fn(async () => ({ count: 1 })),
  };
  const adapter = {
    $transaction: vi.fn(
      async <T>(operation: (tx: typeof adapter) => Promise<T>) =>
        operation(adapter),
    ),
    asset: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    auditLog: { create: vi.fn(async () => ({})) },
    campusWorkPost,
    campusWorkTag,
    contentAssessment: {
      create: vi.fn(async () => ({ id: 'assessment_1' })),
    },
    marketplaceItem: {},
    marketplaceTag: {},
    resource: {},
    resourceTag: {},
    tagDefinition: {
      findMany: vi.fn(async () => [
        {
          campusId: verifiedActor.campusId,
          id: 'preset_work',
          isActive: true,
          isPreset: true,
          scope: 'CAMPUS_WORK',
        },
      ]),
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(),
    },
  };
  return { adapter, callOrder, campusWorkPost, campusWorkTag };
}

type CampusWorkCreate = (
  adapter: unknown,
  actor: typeof verifiedActor,
  input: typeof campusWorkInput,
) => Promise<Record<string, unknown>>;

function campusWorkCreateFunction() {
  return (
    contentService as unknown as {
      createCampusWorkPost?: CampusWorkCreate;
    }
  ).createCampusWorkPost;
}

describe('campus work atomic writes', () => {
  it('publishes passing campus work without assessing its private contact', async () => {
    const { adapter, campusWorkPost } = campusWorkAdapter();
    const outcome = { kind: 'pass' } as const;
    const prepared = {
      assessments: [
        {
          auditSkipped: false,
          data: {
            campusId: verifiedActor.campusId,
            decision: 'PASS',
            providerStatus: 'COMPLETED',
            targetId: 'work_1',
            targetType: 'CAMPUS_WORK',
          },
          outcome,
          targetId: 'work_1',
          targetType: 'CAMPUS_WORK',
        },
      ],
      campusId: verifiedActor.campusId,
      outcome,
    } as unknown as PreparedAssessmentBatch;
    const prepare = vi.fn(async () => prepared);

    const result = await contentService.createCampusWorkPost(
      adapter as unknown as contentService.ContentAdapter,
      verifiedActor,
      campusWorkInput,
      { generateTargetId: () => 'work_1', prepare },
    );

    const serialized = JSON.stringify(prepare.mock.calls);
    expect(serialized).not.toContain(campusWorkInput.contact);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        requests: [
          {
            content: {
              description: campusWorkInput.description,
              location: campusWorkInput.location,
              payText: campusWorkInput.payText,
              title: campusWorkInput.title,
            },
            targetId: 'work_1',
            targetType: 'CAMPUS_WORK',
          },
        ],
      }),
    );
    expect(campusWorkPost.update).toHaveBeenCalledWith({
      data: { status: 'PUBLISHED' },
      where: { id: 'work_1' },
    });
    expect(result).toMatchObject({ id: 'work_1', status: 'PUBLISHED' });
  });

  it('uses only CampusWorkPost for every write path', async () => {
    const create = campusWorkCreateFunction();
    expect(create).toBeTypeOf('function');
    if (!create) return;
    const created = campusWorkAdapter();
    await create(created.adapter, verifiedActor, campusWorkInput);
    expect(created.callOrder).toEqual([
      'campusWorkPost.create',
      'campusWorkPost.update',
    ]);

    const edited = campusWorkAdapter();
    const edit = contentService.editOwnedContent as unknown as (
      adapter: unknown,
      actor: typeof verifiedActor,
      kind: 'campus-work',
      id: string,
      input: typeof campusWorkInput,
    ) => Promise<unknown>;
    await edit(
      edited.adapter,
      verifiedActor,
      'campus-work',
      'work_1',
      campusWorkInput,
    );
    expect(edited.callOrder).toEqual(['campusWorkPost.updateMany']);

    const statusOperations = [
      contentService.archiveOwnedContent,
      contentService.submitOwnedDraft,
    ] as unknown as Array<
      (
        adapter: unknown,
        actor: typeof verifiedActor,
        kind: 'campus-work',
        id: string,
      ) => Promise<unknown>
    >;
    for (const operation of statusOperations) {
      const changed = campusWorkAdapter();
      await operation(changed.adapter, verifiedActor, 'campus-work', 'work_1');
      expect(changed.callOrder).toEqual(['campusWorkPost.updateMany']);
    }
  });

  it('creates the record, tags, and pending status in one Serializable transaction', async () => {
    const create = campusWorkCreateFunction();
    expect(create).toBeTypeOf('function');
    if (!create) return;
    const { adapter, campusWorkPost, campusWorkTag } = campusWorkAdapter();

    const result = await create(adapter, verifiedActor, campusWorkInput);

    expect(adapter.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(campusWorkPost.create).toHaveBeenCalledWith({
      data: {
        authorId: verifiedActor.id,
        campusId: verifiedActor.campusId,
        contact: campusWorkInput.contact,
        description: campusWorkInput.description,
        id: expect.any(String),
        location: campusWorkInput.location,
        payText: campusWorkInput.payText,
        status: 'DRAFT',
        title: campusWorkInput.title,
      },
    });
    const createdId = String(campusWorkPost.create.mock.calls[0]?.[0].data.id);
    expect(campusWorkTag.createMany).toHaveBeenCalledWith({
      data: [
        {
          campusId: verifiedActor.campusId,
          campusWorkPostId: createdId,
          scope: 'CAMPUS_WORK',
          tagId: 'preset_work',
        },
      ],
    });
    expect(campusWorkPost.update).toHaveBeenCalledWith({
      data: { status: 'PENDING' },
      where: { id: createdId },
    });
    expect(result).toMatchObject({ id: createdId, status: 'PENDING' });
  });

  it.each(['P2002', 'P2034'])(
    'restarts the entire transaction for %s',
    async (code) => {
      const create = campusWorkCreateFunction();
      expect(create).toBeTypeOf('function');
      if (!create) return;
      const { adapter, campusWorkPost } = campusWorkAdapter();
      vi.mocked(campusWorkPost.create)
        .mockRejectedValueOnce({ code })
        .mockRejectedValueOnce({ code });

      await create(adapter, verifiedActor, campusWorkInput);

      expect(adapter.$transaction).toHaveBeenCalledTimes(3);
      expect(campusWorkPost.create).toHaveBeenCalledTimes(3);
    },
  );

  it('atomically edits the campus-work record and replaces tags', async () => {
    const { adapter, campusWorkPost, campusWorkTag } = campusWorkAdapter();
    const edit = contentService.editOwnedContent as unknown as (
      adapter: unknown,
      actor: typeof verifiedActor,
      kind: string,
      id: string,
      input: typeof campusWorkInput,
    ) => Promise<unknown>;

    await edit(
      adapter,
      verifiedActor,
      'campus-work',
      'work_1',
      campusWorkInput,
    );

    expect(adapter.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(campusWorkPost.updateMany).toHaveBeenCalledWith({
      data: {
        contact: campusWorkInput.contact,
        description: campusWorkInput.description,
        location: campusWorkInput.location,
        payText: campusWorkInput.payText,
        status: 'DRAFT',
        title: campusWorkInput.title,
      },
      where: {
        authorId: verifiedActor.id,
        id: 'work_1',
        status: { in: ['DRAFT', 'REJECTED'] },
      },
    });
    expect(campusWorkTag.deleteMany).toHaveBeenCalled();
    expect(campusWorkTag.createMany).toHaveBeenCalled();
  });

  it.each([
    ['archiveOwnedContent', 'ARCHIVED', ['PENDING', 'PUBLISHED']],
    ['submitOwnedDraft', 'PENDING', 'DRAFT'],
  ])(
    'writes %s status changes to CampusWorkPost',
    async (name, nextStatus, currentStatus) => {
      const { adapter, campusWorkPost } = campusWorkAdapter();
      const operation = contentService[
        name as 'archiveOwnedContent' | 'submitOwnedDraft'
      ] as unknown as (
        adapter: unknown,
        actor: typeof verifiedActor,
        kind: string,
        id: string,
      ) => Promise<unknown>;

      await operation(adapter, verifiedActor, 'campus-work', 'work_1');

      expect(campusWorkPost.updateMany).toHaveBeenCalledWith({
        data: { status: nextStatus },
        where: {
          authorId: verifiedActor.id,
          id: 'work_1',
          status: Array.isArray(currentStatus)
            ? { in: currentStatus }
            : currentStatus,
        },
      });
      expect(adapter.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    },
  );
});

describe('campus work public presentation', () => {
  it('is campus-scoped, bounded, stable, tag-aware, and strips contact defensively', async () => {
    const { adapter, campusWorkPost } = campusWorkAdapter();
    campusWorkPost.findMany
      .mockResolvedValueOnce([
        {
          createdAt: new Date('2026-07-14T00:00:00Z'),
          id: 'work_1',
          status: 'PUBLISHED',
          tagAssignments: [
            {
              tag: {
                id: 'old_tag',
                isActive: false,
                isPreset: true,
                label: '历史标签',
              },
            },
          ],
          title: '校园活动现场协助',
        },
        {
          createdAt: new Date('2026-07-13T00:00:00Z'),
          id: 'work_2',
          status: 'PUBLISHED',
          tagAssignments: [],
          title: '无联系方式的历史岗位',
        },
      ])
      .mockResolvedValueOnce([{ id: 'work_1' }]);
    const list = contentService.listPublicContent as unknown as (
      adapter: unknown,
      kind: string,
      query: Record<string, unknown>,
    ) => Promise<{ items: Array<Record<string, unknown>> }>;

    const result = await list(adapter, 'campus-work', {
      page: 1,
      pageSize: 12,
      tag: '历史标签',
    });

    expect(campusWorkPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 12,
        where: expect.objectContaining({
          campus: { isActive: true, slug: 'campuslink' },
          status: 'PUBLISHED',
          tagAssignments: {
            some: {
              tag: { label: { equals: '历史标签', mode: 'insensitive' } },
            },
          },
        }),
      }),
    );
    const publicQuery = campusWorkPost.findMany.mock.calls[0]?.[0];
    expect(publicQuery.select).not.toHaveProperty('contact');
    expect(campusWorkPost.findMany.mock.calls[1]?.[0]).toEqual({
      select: { id: true },
      take: 2,
      where: {
        contact: { not: null },
        id: { in: ['work_1', 'work_2'] },
      },
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).not.toHaveProperty('contact');
    expect(result.items[0]).toMatchObject({
      hasContact: true,
      tags: [expect.objectContaining({ isActive: false, label: '历史标签' })],
    });
    expect(result.items[1]).toMatchObject({ hasContact: false, id: 'work_2' });
  });

  it('scopes public detail to the default active campus and strips contact', async () => {
    const { adapter, campusWorkPost } = campusWorkAdapter();
    campusWorkPost.findFirst
      .mockResolvedValueOnce({
        id: 'work_1',
        status: 'PUBLISHED',
        title: '校园活动现场协助',
      })
      .mockResolvedValueOnce({ id: 'work_1' });
    const get = contentService.getPublicContent as unknown as (
      adapter: unknown,
      kind: string,
      id: string,
    ) => Promise<Record<string, unknown> | null>;

    const result = await get(adapter, 'campus-work', 'work_1');

    expect(campusWorkPost.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          campus: { isActive: true, slug: 'campuslink' },
          id: 'work_1',
          status: 'PUBLISHED',
        },
      }),
    );
    expect(
      campusWorkPost.findFirst.mock.calls[0]?.[0].select,
    ).not.toHaveProperty('contact');
    expect(campusWorkPost.findFirst.mock.calls[1]?.[0]).toEqual({
      select: { id: true },
      where: { contact: { not: null }, id: 'work_1' },
    });
    expect(result).not.toHaveProperty('contact');
    expect(result).toMatchObject({ hasContact: true });
  });
});

describe('campus work owner action route', () => {
  it('uses campus-work validation and the complete verified server actor', async () => {
    const edit = vi.fn(async () => ({ id: 'work_1', status: 'DRAFT' }));
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const request = new Request(new URL('/api/campus-work/work_1', appUrl), {
      body: JSON.stringify({ action: 'edit', data: campusWorkInput }),
      headers: {
        'content-type': 'application/json',
        origin: appUrl,
      },
      method: 'PATCH',
    });
    const user = {
      ...verifiedActor,
      email: 'owner@example.edu',
      name: 'Owner',
    };

    const response = await Reflect.apply(handleContentAction, undefined, [
      request,
      'campus-work',
      'work_1',
      { adapter: {}, edit, resolveUser: async () => user },
    ]);

    expect(response.status).toBe(200);
    expect(edit).toHaveBeenCalledWith(
      expect.anything(),
      verifiedActor,
      'campus-work',
      'work_1',
      campusWorkInput,
    );
  });
});
