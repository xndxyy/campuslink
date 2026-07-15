import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildSecurityHeaders } from '@/lib/security/headers';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';
import { plainText, safeDownloadFilename } from '@/lib/security/sanitize';

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
      "connect-src 'self' https://objects.example.test",
    );
  });

  it('allows the virtual-host origin generated for non-path-style R2 uploads', () => {
    const production = buildSecurityHeaders(
      'production',
      'https://account.r2.cloudflarestorage.com',
      'campuslink',
      false,
    );
    expect(production.headers['Content-Security-Policy']).toContain(
      'https://campuslink.account.r2.cloudflarestorage.com',
    );
  });

  it('keeps local path-style MinIO on its configured origin', () => {
    const development = buildSecurityHeaders(
      'development',
      'http://127.0.0.1:9000',
      'campuslink',
      true,
    );
    const csp = development.headers['Content-Security-Policy'];
    expect(csp).toMatch(/img-src[^;]*http:\/\/127\.0\.0\.1:9000/);
    expect(csp).not.toContain('campuslink.127.0.0.1');
  });

  it('rejects loopback HTTP storage origins from the production CSP', () => {
    const production = buildSecurityHeaders(
      'production',
      'http://127.0.0.1:9000',
      'campuslink',
      true,
    );
    expect(production.headers['Content-Security-Policy']).not.toContain(
      'http://127.0.0.1:9000',
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

  it('cancels an oversized streaming body before buffering the remainder', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(new Uint8Array(65 * 1024));
      },
    });
    const request = new Request('https://app.example/api/test', {
      body,
      duplex: 'half',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    } as RequestInit & { duplex: 'half' });
    await expect(readBoundedJson(request)).rejects.toMatchObject({
      code: 'BODY_TOO_LARGE',
      status: 413,
    });
    expect(cancelled).toBe(true);
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
    const sourceFiles: string[] = [];
    const collect = (path: string) => {
      for (const entry of readdirSync(path)) {
        const child = join(path, entry);
        if (statSync(child).isDirectory()) collect(child);
        else if (/\.(?:ts|tsx|js|jsx)$/.test(entry)) sourceFiles.push(child);
      }
    };
    for (const directory of ['app', 'components', 'lib']) {
      collect(resolve(root, directory));
    }
    const source = sourceFiles
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(source).not.toContain('dangerouslySetInnerHTML');
  });

  it('documents versioned moderation and anonymous-identity key rotation', () => {
    const root = resolve(process.cwd());
    const deployment = readFileSync(
      resolve(root, 'docs/deployment.md'),
      'utf8',
    );
    const operations = readFileSync(
      resolve(root, 'docs/operations.md'),
      'utf8',
    );
    const security = readFileSync(resolve(root, 'docs/security.md'), 'utf8');
    const documentation = `${deployment}\n${operations}\n${security}`;

    for (const variable of [
      'AI_CONFIG_ENCRYPTION_KEY_V1',
      'AI_ALLOWED_HOSTS',
      'ANONYMOUS_IDENTITY_KEY_V1',
      'ANONYMOUS_FINGERPRINT_KEY',
    ]) {
      expect(documentation, variable).toContain(variable);
    }
    expect(documentation).toMatch(/key rotation|密钥轮换/i);
    expect(documentation).toMatch(/AI_CHECK_SKIPPED/);
    expect(documentation).toMatch(/TREE_HOLE_AUTHOR_REVEALED/);
  });
});
