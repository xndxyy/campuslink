import type { AssessmentOutput, PublishAssessment } from './assessment-types';
import { findBlockedWordForCampus } from '@/lib/domain/blocked-words';
import { requestOpenAiCompatibleAssessment } from '@/lib/moderation/openai-compatible-client';
import {
  loadAiEncryptionKey,
  openSecret,
} from '@/lib/security/encrypted-secret';
import {
  loadOutboundAiPolicy,
  type fetchWithValidatedAiRedirects,
} from '@/lib/security/outbound-url';

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
  provider(
    content: Readonly<Record<string, string>>,
  ): Promise<AssessmentOutput>;
};

type BatchDependencies = Omit<Dependencies, 'provider'> & {
  provider?: Dependencies['provider'];
};

type AssessmentRequest = {
  content: Readonly<Record<string, string>>;
  targetId: string;
  targetType: AssessmentTarget;
};

export type PublishingAssessmentBatchInput = {
  blockThreshold?: number;
  campusId: string;
  configId?: string;
  model?: string;
  requests: readonly AssessmentRequest[];
  reviewThreshold?: number;
};

export type PublishingOutcome =
  | { kind: 'pass' }
  | { kind: 'skipped' }
  | { kind: 'review'; reasonZh: string }
  | {
      categories: string[];
      kind: 'block';
      reasonZh: string;
      source: 'local' | 'provider';
      suggestionZh: string;
    };

type PreparedAssessment = {
  auditSkipped: boolean;
  data: Record<string, unknown>;
  outcome: PublishingOutcome;
  targetId: string;
  targetType: AssessmentTarget;
};

export interface PreparedAssessmentBatch {
  readonly assessments: readonly PreparedAssessment[];
  readonly campusId: string;
  readonly outcome: PublishingOutcome;
}

export interface PublishingAssessmentPolicy {
  generateTargetId?: () => string;
  prepare(
    input: PublishingAssessmentBatchInput,
  ): Promise<PreparedAssessmentBatch>;
}

export interface ConfiguredPublishingAssessmentAdapter extends ContentAssessmentAdapter {
  aiModerationConfig: {
    findUnique(args: Record<string, unknown>): Promise<{
      baseUrl: string;
      blockThreshold: number;
      enabled: boolean;
      encryptedApiKey: string;
      id: string;
      model: string;
      reviewThreshold: number;
      timeoutMs: number;
    } | null>;
  };
  blockedWord: {
    findMany(
      args: Record<string, unknown>,
    ): Promise<Array<{ category: string; normalized: string }>>;
  };
}

export class ContentBlockedError extends Error {
  readonly categories: string[];
  readonly code = 'CONTENT_BLOCKED' as const;
  readonly reason: string;
  readonly suggestion: string;

  constructor(outcome: Extract<PublishingOutcome, { kind: 'block' }>) {
    super(outcome.reasonZh);
    this.name = 'ContentBlockedError';
    this.categories = [...outcome.categories];
    this.reason = outcome.reasonZh;
    this.suggestion = outcome.suggestionZh;
  }
}

function thresholds(input: PublishingAssessmentBatchInput) {
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
  return { blockThreshold, reviewThreshold };
}

function localText(content: Readonly<Record<string, string>>) {
  return Object.values(content).join('\n');
}

function providerOutcome(
  output: AssessmentOutput,
  reviewThreshold: number,
  blockThreshold: number,
): PublishingOutcome {
  if (output.riskScore >= blockThreshold) {
    return {
      categories: output.categories,
      kind: 'block',
      reasonZh: output.reasonZh,
      source: 'provider',
      suggestionZh: output.suggestionZh,
    };
  }
  if (output.riskScore >= reviewThreshold) {
    return { kind: 'review', reasonZh: output.reasonZh };
  }
  return { kind: 'pass' };
}

function aggregateOutcome(assessments: readonly PreparedAssessment[]) {
  return (
    assessments.find(({ outcome }) => outcome.kind === 'block')?.outcome ??
    assessments.find(({ outcome }) => outcome.kind === 'review')?.outcome ??
    assessments.find(({ outcome }) => outcome.kind === 'skipped')?.outcome ??
    ({ kind: 'pass' } as const)
  );
}

export async function preparePublishingAssessmentBatch(
  _adapter: ContentAssessmentAdapter,
  input: PublishingAssessmentBatchInput,
  dependencies: BatchDependencies,
): Promise<PreparedAssessmentBatch> {
  const { blockThreshold, reviewThreshold } = thresholds(input);
  for (const request of input.requests) {
    const local = await dependencies.localGate(
      input.campusId,
      localText(request.content),
    );
    if (local) {
      return {
        assessments: [],
        campusId: input.campusId,
        outcome: {
          categories: [local.category],
          kind: 'block',
          reasonZh: local.message,
          source: 'local',
          suggestionZh: '请删除或修改不符合社区规范的内容。',
        },
      };
    }
  }

  if (!dependencies.provider) {
    return {
      assessments: [],
      campusId: input.campusId,
      outcome: { kind: 'pass' },
    };
  }

  const assessments: PreparedAssessment[] = [];
  for (const request of input.requests) {
    let output: AssessmentOutput;
    try {
      output = await dependencies.provider(request.content);
    } catch {
      const outcome = { kind: 'skipped' } as const;
      assessments.push({
        auditSkipped: true,
        data: {
          campusId: input.campusId,
          configId: input.configId,
          decision: 'PASS',
          model: input.model,
          providerStatus: 'SKIPPED',
          targetId: request.targetId,
          targetType: request.targetType,
        },
        outcome,
        targetId: request.targetId,
        targetType: request.targetType,
      });
      continue;
    }
    const outcome = providerOutcome(output, reviewThreshold, blockThreshold);
    assessments.push({
      auditSkipped: false,
      data: {
        adminSignals: output.adminSignals,
        campusId: input.campusId,
        categories: output.categories,
        configId: input.configId,
        decision:
          outcome.kind === 'block'
            ? 'BLOCK'
            : outcome.kind === 'review'
              ? 'REVIEW'
              : 'PASS',
        model: input.model,
        providerStatus: 'COMPLETED',
        reasonZh: output.reasonZh,
        riskScore: output.riskScore,
        suggestionZh: output.suggestionZh,
        targetId: request.targetId,
        targetType: request.targetType,
      },
      outcome,
      targetId: request.targetId,
      targetType: request.targetType,
    });
  }
  return {
    assessments,
    campusId: input.campusId,
    outcome: aggregateOutcome(assessments),
  };
}

export function createConfiguredPublishingPolicy(
  adapter: ConfiguredPublishingAssessmentAdapter,
  dependencies: {
    environment?: NodeJS.ProcessEnv;
    request?: typeof fetchWithValidatedAiRedirects;
  } = {},
) {
  return {
    async prepare(input: PublishingAssessmentBatchInput) {
      const config = await adapter.aiModerationConfig.findUnique({
        where: { campusId: input.campusId },
      });
      const localGate = (campusId: string, text: string) =>
        findBlockedWordForCampus(adapter as never, campusId, text);
      if (!config?.enabled) {
        const prepared = await preparePublishingAssessmentBatch(
          adapter,
          input,
          { localGate },
        );
        return prepared.outcome.kind === 'pass'
          ? {
              ...prepared,
              outcome: {
                kind: 'review' as const,
                reasonZh: 'AI 自动审核未启用，内容已转入人工审核。',
              },
            }
          : prepared;
      }
      let providerConfig:
        | {
            apiKey: string;
            baseUrl: string;
            model: string;
            timeoutMs: number;
          }
        | undefined;
      const provider = async (content: Readonly<Record<string, string>>) => {
        if (!providerConfig) {
          const environment = dependencies.environment ?? process.env;
          const keyring = loadAiEncryptionKey(environment);
          providerConfig = {
            apiKey: openSecret(
              JSON.parse(config.encryptedApiKey),
              keyring.keys,
            ),
            baseUrl: config.baseUrl,
            model: config.model,
            timeoutMs: config.timeoutMs,
          };
        }
        return requestOpenAiCompatibleAssessment(providerConfig, content, {
          policy: loadOutboundAiPolicy(dependencies.environment ?? process.env),
          request: dependencies.request,
        });
      };
      return preparePublishingAssessmentBatch(
        adapter,
        {
          ...input,
          blockThreshold: config.blockThreshold,
          configId: config.id,
          model: config.model,
          reviewThreshold: config.reviewThreshold,
        },
        { localGate, provider },
      );
    },
  };
}

export async function persistPreparedAssessmentBatch(
  adapter: ContentAssessmentAdapter,
  prepared: PreparedAssessmentBatch,
) {
  const assessmentIds: string[] = [];
  for (const assessment of prepared.assessments) {
    const record = await adapter.contentAssessment.create({
      data: assessment.data,
    });
    assessmentIds.push(record.id);
    if (assessment.auditSkipped) {
      await adapter.auditLog.create({
        data: {
          action: 'AI_CHECK_SKIPPED',
          campusId: prepared.campusId,
          details: {
            targetId: assessment.targetId,
            targetType: assessment.targetType,
          },
          subjectId: record.id,
        },
      });
    }
  }
  return { assessmentIds, outcome: prepared.outcome };
}

export function publishingOutcomeStatus(outcome: {
  kind: PublishingOutcome['kind'];
}) {
  return outcome.kind === 'block'
    ? 'REJECTED'
    : outcome.kind === 'review'
      ? 'PENDING'
      : 'PUBLISHED';
}

export async function assessContent(
  adapter: ContentAssessmentAdapter,
  input: Input,
  dependencies: Dependencies,
): Promise<PublishAssessment> {
  const prepared = await preparePublishingAssessmentBatch(
    adapter,
    {
      blockThreshold: input.blockThreshold,
      campusId: input.campusId,
      configId: input.configId,
      model: input.model,
      requests: [
        {
          content: { text: input.text },
          targetId: input.targetId,
          targetType: input.targetType,
        },
      ],
      reviewThreshold: input.reviewThreshold,
    },
    dependencies,
  );
  if (
    prepared.outcome.kind === 'block' &&
    prepared.outcome.source === 'local'
  ) {
    return prepared.outcome;
  }
  const persisted = await persistPreparedAssessmentBatch(adapter, prepared);
  return {
    ...persisted.outcome,
    assessmentId: persisted.assessmentIds[0],
  };
}
