import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  presentAiSettings,
  saveAiSettings,
  testAiConnection,
  type AiSettingsAdapter,
  type AiSettingsRecord,
} from '@/lib/domain/ai-settings';
import { sealSecret } from '@/lib/security/encrypted-secret';

const admin = { campusId: 'campus_1', id: 'admin_1', role: 'ADMIN' as const };
const key = Buffer.alloc(32, 0x51);

function adapter(existing: AiSettingsRecord | null = null) {
  const upsert = vi.fn(
    async ({
      create,
      update,
    }: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => ({ id: 'config_1', ...(existing ? update : create) }),
  );
  const db: AiSettingsAdapter = {
    $transaction: async (operation) => operation(db),
    aiModerationConfig: {
      findUnique: vi.fn(async () => existing),
      upsert:
        upsert as unknown as AiSettingsAdapter['aiModerationConfig']['upsert'],
    },
    auditLog: { create: vi.fn(async () => ({})) },
  };
  return { db, upsert };
}

describe('AI moderation settings', () => {
  it('documents the encryption key and exact provider host allowlist', () => {
    const example = readFileSync(
      fileURLToPath(new URL('../../.env.example', import.meta.url)),
      'utf8',
    );
    expect(example).toContain('AI_CONFIG_ENCRYPTION_KEY_V1');
    expect(example).toContain('AI_ALLOWED_HOSTS');
  });
  it('encrypts a new key and presents only its last four characters', async () => {
    const { db, upsert } = adapter();
    const result = await saveAiSettings(
      db,
      admin,
      {
        apiKey: 'provider-secret-1234',
        baseUrl: 'https://api.example.test/v1',
        blockThreshold: 80,
        enabled: true,
        model: 'moderation-model',
        reason: '首次配置校园内容审核模型。',
        reviewThreshold: 40,
        timeoutMs: 8000,
      },
      {
        encryptionKey: key,
        validateUrl: vi.fn(async (value) => new URL(value)),
      },
    );
    expect(result.apiKeyLastFour).toBe('1234');
    expect(JSON.stringify(upsert.mock.calls)).not.toContain(
      'provider-secret-1234',
    );
    expect(result).not.toHaveProperty('encryptedApiKey');
  });

  it('never exposes encrypted material from the presenter', () => {
    expect(
      presentAiSettings({
        apiKeyLastFour: '1234',
        baseUrl: 'https://api.example.test/v1',
        blockThreshold: 80,
        enabled: true,
        encryptedApiKey: 'ciphertext',
        encryptionVersion: 1,
        id: 'config_1',
        model: 'model',
        reviewThreshold: 40,
        timeoutMs: 8000,
      }),
    ).toEqual({
      apiKeyLastFour: '1234',
      baseUrl: 'https://api.example.test/v1',
      blockThreshold: 80,
      enabled: true,
      model: 'model',
      reviewThreshold: 40,
      timeoutMs: 8000,
    });
  });

  it('uses only the fixed connection-test text in the provider payload', async () => {
    const existing: AiSettingsRecord = {
      apiKeyLastFour: '1234',
      baseUrl: 'https://api.example.test/v1',
      blockThreshold: 80,
      enabled: true,
      encryptedApiKey: JSON.stringify(
        sealSecret('provider-secret-1234', key, 1),
      ),
      encryptionVersion: 1,
      id: 'config_1',
      model: 'moderation-model',
      reviewThreshold: 40,
      timeoutMs: 8000,
    };
    const request = vi.fn(
      async (
        url: string | URL,
        policy: { allowedHosts: ReadonlySet<string> },
        init: RequestInit,
      ) => {
        void url;
        void policy;
        void init;
        return new Response('{}', { status: 200 });
      },
    );
    await expect(
      testAiConnection(adapter(existing).db, admin, {
        encryptionKeys: new Map([[1, key]]),
        policy: { allowedHosts: new Set(['api.example.test']) },
        request,
      }),
    ).resolves.toEqual({ ok: true });
    const body = JSON.parse(
      String((request.mock.calls[0]?.[2] as RequestInit).body),
    );
    expect(body.messages).toEqual([
      { content: 'CampusLink moderation connection test', role: 'user' },
    ]);
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('contact');
  });
});
