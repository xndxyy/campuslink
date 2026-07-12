export const MAX_JSON_BODY_BYTES = 64 * 1024;

export class JsonBodyError extends Error {
  constructor(
    public readonly code:
      | 'BODY_REQUIRED'
      | 'BODY_TOO_LARGE'
      | 'INVALID_CONTENT_TYPE'
      | 'INVALID_JSON',
    public readonly status: 400 | 413,
  ) {
    super(code);
    this.name = 'JsonBodyError';
  }
}

export async function readBoundedJson(
  request: Request,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> {
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json')
  ) {
    throw new JsonBodyError('INVALID_CONTENT_TYPE', 400);
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new JsonBodyError('INVALID_JSON', 400);
    }
    if (parsedLength > maxBytes) {
      throw new JsonBodyError('BODY_TOO_LARGE', 413);
    }
  }
  if (!request.body) throw new JsonBodyError('BODY_REQUIRED', 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new JsonBodyError('BODY_TOO_LARGE', 413);
    }
    chunks.push(value);
  }
  if (totalBytes === 0) throw new JsonBodyError('BODY_REQUIRED', 400);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new JsonBodyError('INVALID_JSON', 400);
  }
}
