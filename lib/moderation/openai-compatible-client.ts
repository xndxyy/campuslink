import { z } from 'zod';
import {
  assessmentCategories,
  assessmentSchema,
  type AssessmentOutput,
} from './assessment-types';
import {
  fetchWithValidatedAiRedirects,
  type OutboundAiPolicy,
} from '@/lib/security/outbound-url';

export class AssessmentProviderError extends Error {
  constructor() {
    super('AI assessment provider failed.');
    this.name = 'AssessmentProviderError';
  }
}
const responseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({ message: z.object({ content: z.string() }).passthrough() })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export function parseAssessment(value: string): AssessmentOutput {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192)
    throw new AssessmentProviderError();
  try {
    return assessmentSchema.parse(JSON.parse(value));
  } catch {
    throw new AssessmentProviderError();
  }
}

async function boundedText(response: Response) {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 65_536) throw new AssessmentProviderError();
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw new AssessmentProviderError();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AssessmentProviderError();
  }
}

export async function requestOpenAiCompatibleAssessment(
  config: { apiKey: string; baseUrl: string; model: string; timeoutMs: number },
  content: Readonly<Record<string, string>>,
  dependencies: {
    policy: OutboundAiPolicy;
    request?: typeof fetchWithValidatedAiRedirects;
  },
) {
  const publicFields = [
    'body',
    'comment',
    'description',
    'location',
    'payText',
    'summary',
    'tag',
    'text',
    'title',
  ] as const;
  const publicContent = Object.fromEntries(
    publicFields.flatMap((field) =>
      typeof content[field] === 'string' ? [[field, content[field]]] : [],
    ),
  );
  const serializedContent = JSON.stringify(publicContent);
  if (serializedContent.length > 65_536) throw new AssessmentProviderError();
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
          {
            content: `Return one JSON object only, with exactly these fields: decision (PASS, REVIEW, or BLOCK), riskScore (integer 0-100), categories (array using only: ${assessmentCategories.join(', ')}), reasonZh (Chinese string), suggestionZh (Chinese string), adminSignals (string array). Do not use Markdown fences.`,
            role: 'system',
          },
          { content: serializedContent, role: 'user' },
        ],
        model: config.model,
        temperature: 0,
      }),
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new AssessmentProviderError();
  }
  if (!response.ok) throw new AssessmentProviderError();
  let wrapper: unknown;
  try {
    wrapper = JSON.parse(await boundedText(response));
  } catch (error) {
    if (error instanceof AssessmentProviderError) throw error;
    throw new AssessmentProviderError();
  }
  const parsed = responseSchema.safeParse(wrapper);
  if (!parsed.success) throw new AssessmentProviderError();
  return parseAssessment(parsed.data.choices[0].message.content);
}
