import { openSecret, sealSecret } from '@/lib/security/encrypted-secret';
import {
  fetchWithValidatedAiRedirects,
  type OutboundAiPolicy,
} from '@/lib/security/outbound-url';

type Role = 'STUDENT' | 'MODERATOR' | 'ADMIN';
export interface AiSettingsActor {
  campusId: string;
  id: string;
  role: Role;
}
export interface AiSettingsRecord extends Record<string, unknown> {
  apiKeyLastFour: string;
  baseUrl: string;
  blockThreshold: number;
  enabled: boolean;
  encryptedApiKey: string;
  encryptionVersion: number;
  id: string;
  model: string;
  reviewThreshold: number;
  timeoutMs: number;
}
export interface AiSettingsAdapter {
  $transaction<T>(
    operation: (transaction: AiSettingsAdapter) => Promise<T>,
  ): Promise<T>;
  aiModerationConfig: {
    findUnique(args: Record<string, unknown>): Promise<AiSettingsRecord | null>;
    upsert(args: Record<string, unknown>): Promise<AiSettingsRecord>;
  };
  auditLog: { create(args: Record<string, unknown>): Promise<unknown> };
}
export class AiSettingsForbiddenError extends Error {}
export class AiSettingsValidationError extends Error {}
export class AiSettingsConflictError extends Error {}

export function presentAiSettings(record: AiSettingsRecord) {
  return {
    apiKeyLastFour: record.apiKeyLastFour,
    baseUrl: record.baseUrl,
    blockThreshold: record.blockThreshold,
    enabled: record.enabled,
    model: record.model,
    reviewThreshold: record.reviewThreshold,
    timeoutMs: record.timeoutMs,
  };
}

export async function getAiSettings(
  adapter: AiSettingsAdapter,
  actor: AiSettingsActor,
) {
  requireAdmin(actor);
  const record = await adapter.aiModerationConfig.findUnique({
    where: { campusId: actor.campusId },
  });
  return record ? presentAiSettings(record) : null;
}

function requireAdmin(actor: AiSettingsActor) {
  if (actor.role !== 'ADMIN')
    throw new AiSettingsForbiddenError('AI settings access is forbidden');
}
function text(value: string, maximum: number) {
  if (typeof value !== 'string')
    throw new AiSettingsValidationError('Invalid AI settings');
  const result = value.trim();
  if (!result || result.length > maximum)
    throw new AiSettingsValidationError('Invalid AI settings');
  return result;
}
function reason(value: string) {
  const result = text(value, 1000);
  if (result.length < 5)
    throw new AiSettingsValidationError('Invalid AI settings reason');
  return result;
}

export async function saveAiSettings(
  adapter: AiSettingsAdapter,
  actor: AiSettingsActor,
  input: {
    apiKey?: string;
    baseUrl: string;
    blockThreshold: number;
    enabled: boolean;
    model: string;
    reason: string;
    reviewThreshold: number;
    timeoutMs: number;
  },
  dependencies: {
    encryptionKey: Buffer;
    validateUrl(value: string): Promise<URL>;
  },
) {
  requireAdmin(actor);
  if (
    typeof input.enabled !== 'boolean' ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 1000 ||
    input.timeoutMs > 60000 ||
    !Number.isInteger(input.reviewThreshold) ||
    !Number.isInteger(input.blockThreshold) ||
    input.reviewThreshold < 0 ||
    input.reviewThreshold >= input.blockThreshold ||
    input.blockThreshold > 100
  )
    throw new AiSettingsValidationError('Invalid AI settings');
  const baseUrl = (
    await dependencies.validateUrl(text(input.baseUrl, 500))
  ).toString();
  const model = text(input.model, 200);
  const governanceReason = reason(input.reason);
  const existing = await adapter.aiModerationConfig.findUnique({
    where: { campusId: actor.campusId },
  });
  let secret: {
    apiKeyLastFour: string;
    encryptedApiKey: string;
    encryptionVersion: number;
  };
  if (input.apiKey !== undefined) {
    const apiKey = text(input.apiKey, 4096);
    if (apiKey.length < 8)
      throw new AiSettingsValidationError('Invalid AI API key');
    secret = {
      apiKeyLastFour: apiKey.slice(-4),
      encryptedApiKey: JSON.stringify(
        sealSecret(apiKey, dependencies.encryptionKey, 1),
      ),
      encryptionVersion: 1,
    };
  } else if (existing) {
    secret = {
      apiKeyLastFour: existing.apiKeyLastFour,
      encryptedApiKey: existing.encryptedApiKey,
      encryptionVersion: existing.encryptionVersion,
    };
  } else {
    throw new AiSettingsValidationError('AI API key is required');
  }
  const data = {
    campusId: actor.campusId,
    enabled: input.enabled,
    baseUrl,
    model,
    timeoutMs: input.timeoutMs,
    reviewThreshold: input.reviewThreshold,
    blockThreshold: input.blockThreshold,
    ...secret,
  };
  const saved = await adapter.$transaction(async (transaction) => {
    const record = await transaction.aiModerationConfig.upsert({
      create: data,
      update: data,
      where: { campusId: actor.campusId },
    });
    await transaction.auditLog.create({
      data: {
        action: 'AI_MODERATION_SETTINGS_UPDATED',
        actorId: actor.id,
        campusId: actor.campusId,
        subjectId: record.id,
        details: { enabled: input.enabled, model, reason: governanceReason },
      },
    });
    return record;
  });
  return presentAiSettings(saved);
}

export async function testAiConnection(
  adapter: AiSettingsAdapter,
  actor: AiSettingsActor,
  dependencies: {
    encryptionKeys: ReadonlyMap<number, Buffer>;
    policy: OutboundAiPolicy;
    request?: typeof fetchWithValidatedAiRedirects;
  },
) {
  requireAdmin(actor);
  const config = await adapter.aiModerationConfig.findUnique({
    where: { campusId: actor.campusId },
  });
  if (!config)
    throw new AiSettingsConflictError('AI settings are not configured');
  let envelope: unknown;
  try {
    envelope = JSON.parse(config.encryptedApiKey);
  } catch {
    throw new AiSettingsConflictError('AI settings are unavailable');
  }
  const apiKey = openSecret(envelope, dependencies.encryptionKeys);
  const endpoint = new URL(config.baseUrl);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/chat/completions`;
  endpoint.search = '';
  endpoint.hash = '';
  const request = dependencies.request ?? fetchWithValidatedAiRedirects;
  let response: Response;
  try {
    response = await request(endpoint, dependencies.policy, {
      body: JSON.stringify({
        messages: [
          { content: 'CampusLink moderation connection test', role: 'user' },
        ],
        model: config.model,
        temperature: 0,
      }),
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new AiSettingsConflictError('AI provider connection failed');
  }
  if (!response.ok)
    throw new AiSettingsConflictError('AI provider connection failed');
  return { ok: true };
}
