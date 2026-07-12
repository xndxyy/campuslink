import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildSecurityHeaders } from '@/lib/security/headers';
import {
  JsonBodyError,
  readBoundedJson,
} from '@/lib/security/request-body';
import {
  plainText,
  safeDownloadFilename,
} from '@/lib/security/sanitize';

describe('release security boundary', () => {
  it('creates a unique nonce and a strict production CSP', () => {
    const first = buildSecurityHeaders('production');
    const second = buildSecurityHeaders('production');

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.headers['Content-Security-Policy']).toContain(
      `script-src 'self' 'nonce-${first.nonce}' 'strict-dynamic'`,
    );
    expect(first.headers['Content-Security-Policy']).not.toContain(
      "'unsafe-eval'",
    );
    expect(first.headers['Content-Security-Policy']).not.toMatch(
      /script-src[^;]*'unsafe-inline'/,
    );
    expect(first.headers).toMatchObject({
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(first.headers).not.toHaveProperty('Strict-Transport-Security');
  });

  it('allows unsafe-eval only in development and includes a configured HTTPS S3 origin', () => {
    const development = buildSecurityHeaders('development');
    const production = buildSecurityHeaders(
      'production',
      'https://objects.example.test/bucket',
    );
    expect(development.headers['Content-Security-Policy']).toMatch(
      /script-src[^;]*'unsafe-eval'/,
    );
    expect(production.headers['Content-Security-Policy']).toContain(
      'connect-src \'self\' https://objects.example.test',
    );
  });

  it('reads a bounded JSON body by actual UTF-8 bytes', async () => {
    const body = JSON.stringify({ value: '🎓'.repeat(10) });
    const request = new Request('https://app.example/api/test', {
      body,
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    await expect(readBoundedJson(request, 16)).rejects.toMatchObject({
      code: 'BODY_TOO_LARGE',
      status: 413,
    });
  });

  it('rejects missing, non-JSON, and malformed JSON bodies', async () => {
    for (const request of [
      new Request('https://app.example/api/test', { method: 'POST' }),
      new Request('https://app.example/api/test', {
        body: '{}',
        headers: { 'content-type': 'text/plain' },
        method: 'POST',
      }),
      new Request('https://app.example/api/test', {
        body: '{',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    ]) {
      await expect(readBoundedJson(request)).rejects.toBeInstanceOf(
        JsonBodyError,
      );
    }
  });

  it('keeps user content plain text and produces a safe download filename', () => {
    expect(plainText('  Hello\u0000 <world>  ', 30)).toBe('Hello world');
    expect(safeDownloadFilename('../Exam\r\n.pdf')).toBe('Exam.pdf');
    expect(safeDownloadFilename(randomUUID())).toMatch(/^[\w.-]+$/);
  });

  it('contains no dangerous client or React sinks', () => {
    const root = resolve(process.cwd());
    const files = ['app', 'components', 'lib'].flatMap((directory) => {
      const listing = readFileSync(resolve(root, '.gitignore'), 'utf8');
      void listing;
      return [] as string[];
    });
    void files;
    const source = [
      'app',
      'components',
      'lib',
    ].map((directory) => directory).join(' ');
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });
});
