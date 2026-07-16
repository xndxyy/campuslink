import { describe, expect, it, vi } from 'vitest';

import {
  assessContent,
  type ContentAssessmentAdapter,
  createConfiguredPublishingPolicy,
  persistPreparedAssessmentBatch,
  preparePublishingAssessmentBatch,
  publishingOutcomeStatus,
} from '@/lib/moderation/content-assessment';
import { sealSecret } from '@/lib/security/encrypted-secret';
import { fetchWithValidatedAiRedirects } from '@/lib/security/outbound-url';

function adapter() {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'assessment_1',
    ...data,
  }));
  return {
    adapter: {
      auditLog: { create: vi.fn(async () => ({})) },
      contentAssessment: { create },
    } as unknown as ContentAssessmentAdapter,
    create,
  };
}

describe('common content assessment', () => {
  it('keeps the local gate active when AI has not been configured', async () => {
    const db = adapter();
    const productionAdapter = Object.assign(db.adapter, {
      aiModerationConfig: { findUnique: vi.fn(async () => null) },
      blockedWord: {
        findMany: vi.fn(async () => [
          { category: '广告垃圾', normalized: '违规交易' },
        ]),
      },
    });
    const policy = createConfiguredPublishingPolicy(productionAdapter);

    const prepared = await policy.prepare({
      campusId: 'campus_without_ai',
      requests: [
        {
          content: { title: '违 规-交易' },
          targetId: 'market_1',
          targetType: 'MARKETPLACE_ITEM',
        },
      ],
    });

    expect(prepared.outcome).toMatchObject({
      categories: ['广告垃圾'],
      kind: 'block',
      source: 'local',
    });
    expect(
      productionAdapter.aiModerationConfig.findUnique,
    ).toHaveBeenCalledWith({ where: { campusId: 'campus_without_ai' } });
    expect(db.create).not.toHaveBeenCalled();
  });

  it('auto-passes ordinary content when AI is disabled', async () => {
    const db = adapter();
    const productionAdapter = Object.assign(db.adapter, {
      aiModerationConfig: { findUnique: vi.fn(async () => null) },
      blockedWord: { findMany: vi.fn(async () => []) },
    });
    const policy = createConfiguredPublishingPolicy(productionAdapter);

    const prepared = await policy.prepare({
      campusId: 'campus_manual_review',
      requests: [
        {
          content: { title: '普通校园内容' },
          targetId: 'resource_1',
          targetType: 'RESOURCE',
        },
      ],
    });

    expect(prepared.outcome).toStrictEqual({ kind: 'pass' });
    expect(prepared.assessments).toHaveLength(0);
  });

  it('uses encrypted enabled configuration and administrator thresholds', async () => {
    const db = adapter();
    const encryptionKey = Buffer.alloc(32, 0x41);
    const productionAdapter = Object.assign(db.adapter, {
      aiModerationConfig: {
        findUnique: vi.fn(async () => ({
          baseUrl: 'https://moderation.example.com/v1',
          blockThreshold: 80,
          enabled: true,
          encryptedApiKey: JSON.stringify(
            sealSecret('provider-secret', encryptionKey, 1),
          ),
          id: 'config_1',
          model: 'moderation-model',
          reviewThreshold: 40,
          timeoutMs: 8000,
        })),
      },
      blockedWord: { findMany: vi.fn(async () => []) },
    });
    const request = vi.fn(
      async (...args: Parameters<typeof fetchWithValidatedAiRedirects>) => {
        void args;
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  adminSignals: ['需要复核'],
                  categories: ['广告垃圾'],
                  decision: 'PASS',
                  reasonZh: '风险分达到人工复核阈值',
                  riskScore: 55,
                  suggestionZh: '删除推广内容后重新提交',
                }),
              },
            },
          ],
        });
      },
    );
    const policy = createConfiguredPublishingPolicy(productionAdapter, {
      environment: {
        AI_ALLOWED_HOSTS: 'moderation.example.com',
        AI_CONFIG_ENCRYPTION_KEY_V1: encryptionKey.toString('base64'),
        NODE_ENV: 'test',
      },
      request,
    });

    const prepared = await policy.prepare({
      campusId: 'campus_with_ai',
      requests: [
        {
          content: { title: '普通校园内容' },
          targetId: 'post_1',
          targetType: 'FORUM_POST',
        },
      ],
    });

    expect(prepared.outcome).toMatchObject({ kind: 'review' });
    const requestBody = JSON.parse(
      String((request.mock.calls[0]?.[2] as RequestInit | undefined)?.body),
    ) as { messages: Array<{ content: string; role: string }> };
    expect(requestBody.messages[1]).toStrictEqual({
      content: JSON.stringify({ title: '普通校园内容' }),
      role: 'user',
    });
    expect(JSON.stringify(request.mock.calls)).not.toContain(
      'private-contact@example.com',
    );
  });

  it('finishes every local gate before making any provider request', async () => {
    const db = adapter();
    const provider = vi.fn(async () => ({
      adminSignals: [],
      categories: [],
      decision: 'PASS' as const,
      reasonZh: '内容符合社区规范',
      riskScore: 3,
      suggestionZh: '无需修改',
    }));
    const localGate = vi.fn(async (_campusId: string, text: string) =>
      text.includes('违规标签')
        ? {
            category: '广告垃圾',
            message: '内容包含不符合社区规范的词语，请修改后重试。',
          }
        : null,
    );

    const prepared = await preparePublishingAssessmentBatch(
      db.adapter,
      {
        blockThreshold: 80,
        campusId: 'campus_1',
        configId: 'config_1',
        model: 'moderation-model',
        requests: [
          {
            content: { summary: '普通摘要', title: '普通标题' },
            targetId: 'resource_1',
            targetType: 'RESOURCE',
          },
          {
            content: { tag: '违规标签' },
            targetId: 'resource_1:tag:0',
            targetType: 'CUSTOM_TAG',
          },
        ],
        reviewThreshold: 40,
      },
      { localGate, provider },
    );

    expect(prepared.outcome).toMatchObject({
      categories: ['广告垃圾'],
      kind: 'block',
      source: 'local',
    });
    expect(localGate).toHaveBeenCalledTimes(2);
    expect(provider).not.toHaveBeenCalled();
    expect(db.create).not.toHaveBeenCalled();
  });

  it('persists skipped assessments and their audit only after preparation', async () => {
    const db = adapter();
    const prepared = await preparePublishingAssessmentBatch(
      db.adapter,
      {
        campusId: 'campus_1',
        configId: 'config_1',
        model: 'moderation-model',
        requests: [
          {
            content: { body: '普通论坛正文' },
            targetId: 'post_1',
            targetType: 'FORUM_POST',
          },
        ],
      },
      {
        localGate: vi.fn(async () => null),
        provider: vi.fn(async () => {
          throw new Error('provider secret');
        }),
      },
    );

    expect(prepared.outcome.kind).toBe('skipped');
    expect(db.create).not.toHaveBeenCalled();
    expect(db.adapter.auditLog.create).not.toHaveBeenCalled();

    const persisted = await persistPreparedAssessmentBatch(
      db.adapter,
      prepared,
    );

    expect(persisted.outcome.kind).toBe('skipped');
    expect(db.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decision: 'PASS',
          providerStatus: 'SKIPPED',
          targetId: 'post_1',
        }),
      }),
    );
    expect(db.adapter.auditLog.create).toHaveBeenCalledWith({
      data: {
        action: 'AI_CHECK_SKIPPED',
        campusId: 'campus_1',
        details: { targetId: 'post_1', targetType: 'FORUM_POST' },
        subjectId: 'assessment_1',
      },
    });
  });

  it.each([
    ['pass', 'PUBLISHED'],
    ['skipped', 'PUBLISHED'],
    ['review', 'PENDING'],
    ['block', 'REJECTED'],
  ] as const)('maps a %s outcome to %s', (kind, status) => {
    expect(publishingOutcomeStatus({ kind })).toBe(status);
  });

  it('runs the local blocked-word gate before the provider', async () => {
    const provider = vi.fn();
    const db = adapter();
    const result = await assessContent(
      db.adapter,
      {
        campusId: 'campus_1',
        targetId: 'target_1',
        targetType: 'RESOURCE',
        text: '违规交易',
      },
      {
        localGate: vi.fn(async () => ({
          category: '诈骗引流',
          message: '内容包含不符合社区规范的词语，请修改后重试。',
        })),
        provider,
      },
    );
    expect(result.kind).toBe('block');
    expect(provider).not.toHaveBeenCalled();
  });

  it('fails open, persists skipped status, and audits provider failure', async () => {
    const db = adapter();
    const result = await assessContent(
      db.adapter,
      {
        campusId: 'campus_1',
        targetId: 'target_1',
        targetType: 'FORUM_POST',
        text: '普通内容',
      },
      {
        localGate: vi.fn(async () => null),
        provider: vi.fn(async () => {
          throw new Error('secret provider detail');
        }),
      },
    );
    expect(result).toMatchObject({ kind: 'skipped' });
    expect(db.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decision: 'PASS',
          providerStatus: 'SKIPPED',
        }),
      }),
    );
  });

  it('maps risk score through administrator thresholds instead of trusting provider decision', async () => {
    const db = adapter();
    const result = await assessContent(
      db.adapter,
      {
        blockThreshold: 80,
        campusId: 'campus_1',
        reviewThreshold: 40,
        targetId: 'target_1',
        targetType: 'RESOURCE',
        text: '高风险内容',
      },
      {
        localGate: vi.fn(async () => null),
        provider: vi.fn(async () => ({
          adminSignals: [],
          categories: ['诈骗引流' as const],
          decision: 'PASS' as const,
          reasonZh: '风险分数很高',
          riskScore: 91,
          suggestionZh: '删除风险内容',
        })),
      },
    );
    expect(result.kind).toBe('block');
    expect(db.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decision: 'BLOCK', riskScore: 91 }),
      }),
    );
  });
});
