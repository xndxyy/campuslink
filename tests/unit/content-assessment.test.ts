import { describe, expect, it, vi } from 'vitest';

import {
  assessContent,
  type ContentAssessmentAdapter,
} from '@/lib/moderation/content-assessment';

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
