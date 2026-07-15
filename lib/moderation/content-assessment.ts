import type { AssessmentOutput, PublishAssessment } from './assessment-types';

export type AssessmentTarget =
  | 'RESOURCE'
  | 'MARKETPLACE_ITEM'
  | 'CAMPUS_WORK'
  | 'FORUM_POST'
  | 'FORUM_COMMENT'
  | 'CUSTOM_TAG';
export interface ContentAssessmentAdapter {
  contentAssessment: {
    create(args: Record<string, unknown>): Promise<{ id: string }>;
  };
  auditLog: { create(args: Record<string, unknown>): Promise<unknown> };
}
type Input = {
  blockThreshold?: number;
  campusId: string;
  configId?: string;
  model?: string;
  reviewThreshold?: number;
  targetId: string;
  targetType: AssessmentTarget;
  text: string;
};
type Dependencies = {
  localGate(
    campusId: string,
    text: string,
  ): Promise<{ category: string; message: string } | null>;
  provider(content: { text: string }): Promise<AssessmentOutput>;
};

export async function assessContent(
  adapter: ContentAssessmentAdapter,
  input: Input,
  dependencies: Dependencies,
): Promise<PublishAssessment> {
  const local = await dependencies.localGate(input.campusId, input.text);
  if (local) {
    const record = await adapter.contentAssessment.create({
      data: {
        campusId: input.campusId,
        categories: [local.category],
        decision: 'BLOCK',
        providerStatus: 'SKIPPED',
        reasonZh: local.message,
        suggestionZh: '请删除或修改不符合社区规范的内容。',
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });
    return {
      assessmentId: record.id,
      categories: [local.category],
      kind: 'block',
      reasonZh: local.message,
      suggestionZh: '请删除或修改不符合社区规范的内容。',
    };
  }
  let output: AssessmentOutput;
  try {
    output = await dependencies.provider({ text: input.text });
  } catch {
    const record = await adapter.contentAssessment.create({
      data: {
        campusId: input.campusId,
        configId: input.configId,
        decision: 'PASS',
        model: input.model,
        providerStatus: 'SKIPPED',
        targetId: input.targetId,
        targetType: input.targetType,
      },
    });
    await adapter.auditLog.create({
      data: {
        action: 'AI_CHECK_SKIPPED',
        campusId: input.campusId,
        subjectId: record.id,
        details: { targetId: input.targetId, targetType: input.targetType },
      },
    });
    return { assessmentId: record.id, kind: 'skipped' };
  }
  const reviewThreshold = input.reviewThreshold ?? 40;
  const blockThreshold = input.blockThreshold ?? 80;
  if (
    !Number.isInteger(reviewThreshold) ||
    !Number.isInteger(blockThreshold) ||
    reviewThreshold < 0 ||
    reviewThreshold >= blockThreshold ||
    blockThreshold > 100
  ) {
    throw new Error('Invalid assessment thresholds');
  }
  const decision =
    output.riskScore >= blockThreshold
      ? 'BLOCK'
      : output.riskScore >= reviewThreshold
        ? 'REVIEW'
        : 'PASS';
  const record = await adapter.contentAssessment.create({
    data: {
      adminSignals: output.adminSignals,
      campusId: input.campusId,
      categories: output.categories,
      configId: input.configId,
      decision,
      model: input.model,
      providerStatus: 'COMPLETED',
      reasonZh: output.reasonZh,
      riskScore: output.riskScore,
      suggestionZh: output.suggestionZh,
      targetId: input.targetId,
      targetType: input.targetType,
    },
  });
  if (decision === 'PASS') return { assessmentId: record.id, kind: 'pass' };
  if (decision === 'REVIEW')
    return {
      assessmentId: record.id,
      kind: 'review',
      reasonZh: output.reasonZh,
    };
  return {
    assessmentId: record.id,
    categories: output.categories,
    kind: 'block',
    reasonZh: output.reasonZh,
    suggestionZh: output.suggestionZh,
  };
}
