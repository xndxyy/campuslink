import { describe, expect, it, vi } from 'vitest';

import {
  AssessmentProviderError,
  parseAssessment,
  requestOpenAiCompatibleAssessment,
} from '@/lib/moderation/openai-compatible-client';

const valid = JSON.stringify({
  adminSignals: [],
  categories: ['诈骗引流'],
  decision: 'BLOCK',
  reasonZh: '包含诱导转账内容',
  riskScore: 91,
  suggestionZh: '删除转账诱导后重试',
});

describe('OpenAI-compatible moderation client', () => {
  it('parses strict JSON assessment output', () => {
    expect(parseAssessment(valid)).toMatchObject({
      decision: 'BLOCK',
      riskScore: 91,
    });
  });

  it.each([
    `\`\`\`json\n${valid}\n\`\`\``,
    '{bad json}',
    JSON.stringify({ ...JSON.parse(valid), extra: true }),
  ])('rejects fenced, malformed, or non-strict output', (value) => {
    expect(() => parseAssessment(value)).toThrow(AssessmentProviderError);
  });

  it('sends only public content fields and returns a structured assessment', async () => {
    const request = vi.fn(
      async (
        url: string | URL,
        policy: { allowedHosts: ReadonlySet<string> },
        init: RequestInit,
      ) => {
        void url;
        void policy;
        void init;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: valid } }] }),
          { headers: { 'content-type': 'application/json' }, status: 200 },
        );
      },
    );
    const result = await requestOpenAiCompatibleAssessment(
      {
        apiKey: 'provider-secret',
        baseUrl: 'https://api.example.test/v1',
        model: 'moderation-model',
        timeoutMs: 8000,
      },
      {
        body: '公开正文',
        contact: 'private-contact',
        email: 'private@example.test',
        title: '公开标题',
      },
      { policy: { allowedHosts: new Set(['api.example.test']) }, request },
    );
    expect(result.decision).toBe('BLOCK');
    const payload = JSON.parse(
      String((request.mock.calls[0]?.[2] as RequestInit).body),
    );
    expect(JSON.stringify(payload)).not.toContain('contact');
    expect(JSON.stringify(payload)).not.toContain('email');
    expect(JSON.stringify(payload)).not.toContain('private-contact');
    expect(JSON.stringify(payload)).not.toContain('private@example.test');
  });
});
