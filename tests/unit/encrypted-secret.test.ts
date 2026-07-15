import { describe, expect, it } from 'vitest';

import {
  EncryptedSecretError,
  openSecret,
  sealSecret,
} from '@/lib/security/encrypted-secret';

const key = Buffer.alloc(32, 0x41);

describe('encrypted AI configuration secrets', () => {
  it('round trips with AES-GCM without storing plaintext', () => {
    const envelope = sealSecret('provider-secret-value', key, 1);
    expect(openSecret(envelope, new Map([[1, key]]))).toBe(
      'provider-secret-value',
    );
    expect(JSON.stringify(envelope)).not.toContain('provider-secret-value');
  });

  it('rejects tampering and invalid key sizes', () => {
    const envelope = sealSecret('provider-secret-value', key, 1);
    expect(() =>
      openSecret(
        { ...envelope, tag: Buffer.alloc(16).toString('base64') },
        new Map([[1, key]]),
      ),
    ).toThrow(EncryptedSecretError);
    expect(() =>
      sealSecret('provider-secret-value', Buffer.alloc(31), 1),
    ).toThrow(EncryptedSecretError);
  });
});
