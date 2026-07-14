import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_ANONYMOUS_IDENTITY_CIPHERTEXT_BASE64_CHARS,
  MAX_ANONYMOUS_IDENTITY_KEY_VERSION,
  MAX_ANONYMOUS_IDENTITY_SERIALIZED_ENVELOPE_CHARS,
  AnonymousIdentityError,
  fingerprintAnonymousUser,
  loadAnonymousIdentityKeyring,
  openAnonymousIdentity,
  parseAnonymousIdentityEnvelope,
  parseSerializedAnonymousIdentityEnvelope,
  sealAnonymousIdentity,
  serializeAnonymousIdentityEnvelope,
  type AnonymousIdentityEnvelope,
  type AnonymousIdentityKeyring,
} from '@/lib/security/anonymous-identity';

const encryptionKeyV1 = Buffer.alloc(32, 0x11);
const encryptionKeyV2 = Buffer.alloc(32, 0x22);
const fingerprintKey = Buffer.alloc(32, 0x33);
const environmentExample = readFileSync(
  fileURLToPath(new URL('../../.env.example', import.meta.url)),
  'utf8',
);

function keyring(
  currentVersion = 1,
  fingerprint = fingerprintKey,
): AnonymousIdentityKeyring {
  return {
    currentVersion,
    encryptionKeys: new Map([
      [1, encryptionKeyV1],
      [2, encryptionKeyV2],
    ]),
    fingerprintKey: fingerprint,
  };
}

function tamperBase64(value: string) {
  const bytes = Buffer.from(value, 'base64');
  bytes[bytes.length - 1] ^= 0x01;
  return bytes.toString('base64');
}

describe('anonymous identity authenticated encryption', () => {
  it('round trips the maximum 191-code-unit identity within exported bounds', () => {
    const maximumIdentity = '界'.repeat(191);
    const envelope = sealAnonymousIdentity(maximumIdentity, keyring());
    const serialized = serializeAnonymousIdentityEnvelope(envelope);
    expect(MAX_ANONYMOUS_IDENTITY_CIPHERTEXT_BASE64_CHARS).toBe(764);
    expect(MAX_ANONYMOUS_IDENTITY_SERIALIZED_ENVELOPE_CHARS).toBe(2_048);
    expect(envelope.ciphertext).toHaveLength(764);
    expect(serialized.length).toBeLessThanOrEqual(2_048);
    expect(openAnonymousIdentity(envelope, keyring())).toBe(maximumIdentity);
  });

  it('rejects overlong ciphertext before any Base64 decode', () => {
    const bufferFrom = vi.spyOn(Buffer, 'from');
    try {
      expect(() =>
        parseAnonymousIdentityEnvelope({
          ciphertext: 'A'.repeat(768),
          iv: Buffer.alloc(12).toString('base64'),
          keyVersion: 1,
          tag: Buffer.alloc(16).toString('base64'),
        }),
      ).toThrow(AnonymousIdentityError);
      expect(bufferFrom).not.toHaveBeenCalled();
    } finally {
      bufferFrom.mockRestore();
    }
  });

  it('rejects an overlong serialized envelope before JSON.parse', () => {
    const jsonParse = vi.spyOn(JSON, 'parse');
    try {
      expect(() =>
        parseSerializedAnonymousIdentityEnvelope('x'.repeat(2_049)),
      ).toThrow(AnonymousIdentityError);
      expect(jsonParse).not.toHaveBeenCalled();
    } finally {
      jsonParse.mockRestore();
    }
  });

  it('accepts signed-int32 max keyVersion and rejects max plus one everywhere', () => {
    const maximumVersion = 0x7fff_ffff;
    const invalidVersion = maximumVersion + 1;
    const maximumKey = Buffer.alloc(32, 0x71);
    const maximumVersionKeys: AnonymousIdentityKeyring = {
      currentVersion: maximumVersion,
      encryptionKeys: new Map([[maximumVersion, maximumKey]]),
      fingerprintKey,
    };
    const maximumEnvelope = sealAnonymousIdentity(
      'user_123',
      maximumVersionKeys,
    );

    expect(MAX_ANONYMOUS_IDENTITY_KEY_VERSION).toBe(maximumVersion);
    expect(maximumEnvelope.keyVersion).toBe(maximumVersion);
    expect(openAnonymousIdentity(maximumEnvelope, maximumVersionKeys)).toBe(
      'user_123',
    );
    expect(
      loadAnonymousIdentityKeyring(
        {
          ANONYMOUS_FINGERPRINT_KEY: fingerprintKey.toString('base64'),
          [`ANONYMOUS_IDENTITY_KEY_V${maximumVersion}`]:
            maximumKey.toString('base64'),
        },
        { currentVersion: maximumVersion, versions: [maximumVersion] },
      ).currentVersion,
    ).toBe(maximumVersion);

    const invalidVersionKeys: AnonymousIdentityKeyring = {
      currentVersion: invalidVersion,
      encryptionKeys: new Map([[invalidVersion, maximumKey]]),
      fingerprintKey,
    };
    expect(() => sealAnonymousIdentity('user_123', invalidVersionKeys)).toThrow(
      AnonymousIdentityError,
    );
    expect(() =>
      parseAnonymousIdentityEnvelope({
        ...maximumEnvelope,
        keyVersion: invalidVersion,
      }),
    ).toThrow(AnonymousIdentityError);
    expect(() =>
      loadAnonymousIdentityKeyring(
        {
          ANONYMOUS_FINGERPRINT_KEY: fingerprintKey.toString('base64'),
          [`ANONYMOUS_IDENTITY_KEY_V${invalidVersion}`]:
            maximumKey.toString('base64'),
        },
        { currentVersion: invalidVersion, versions: [invalidVersion] },
      ),
    ).toThrow(AnonymousIdentityError);
  });

  it('round trips V1 and V2 with random 12-byte IVs and 16-byte tags', () => {
    const first = sealAnonymousIdentity('user_123', keyring(), 1);
    const second = sealAnonymousIdentity('user_123', keyring(2), 2);
    const repeated = sealAnonymousIdentity('user_123', keyring(), 1);

    expect(openAnonymousIdentity(first, keyring())).toBe('user_123');
    expect(openAnonymousIdentity(second, keyring(2))).toBe('user_123');
    expect(Buffer.from(first.iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(first.tag, 'base64')).toHaveLength(16);
    expect(first.iv).not.toBe(repeated.iv);
    expect(first.ciphertext).not.toBe(repeated.ciphertext);
  });

  it.each(['ciphertext', 'iv', 'tag'] as const)(
    'rejects a tampered %s without exposing identity or key material',
    (field) => {
      const envelope = sealAnonymousIdentity('private_user_123', keyring());
      const tampered = { ...envelope, [field]: tamperBase64(envelope[field]) };

      expect(() => openAnonymousIdentity(tampered, keyring())).toThrow(
        AnonymousIdentityError,
      );
      try {
        openAnonymousIdentity(tampered, keyring());
      } catch (error) {
        expect(String(error)).not.toContain('private_user_123');
        expect(String(error)).not.toContain(encryptionKeyV1.toString('base64'));
      }
    },
  );

  it('authenticates keyVersion and rejects a version substitution', () => {
    const envelope = sealAnonymousIdentity('user_123', keyring(), 1);
    expect(() =>
      openAnonymousIdentity({ ...envelope, keyVersion: 2 }, keyring(2)),
    ).toThrow(AnonymousIdentityError);
  });

  it('serializes and parses only the complete strict envelope shape', () => {
    const envelope = sealAnonymousIdentity('user_123', keyring());
    const serialized = serializeAnonymousIdentityEnvelope(envelope);

    expect(parseAnonymousIdentityEnvelope(JSON.parse(serialized))).toEqual(
      envelope,
    );
    for (const malformed of [
      null,
      {},
      { ...envelope, extra: 'not-allowed' },
      { ...envelope, ciphertext: '*' },
      { ...envelope, iv: Buffer.alloc(11).toString('base64') },
      { ...envelope, tag: Buffer.alloc(15).toString('base64') },
      { ...envelope, keyVersion: 0 },
      { ...envelope, keyVersion: 1.5 },
    ]) {
      expect(() => parseAnonymousIdentityEnvelope(malformed)).toThrow(
        AnonymousIdentityError,
      );
    }
  });

  it('rejects unknown versions and malformed decrypted identity values', () => {
    const envelope = sealAnonymousIdentity('user_123', keyring());
    const missingVersionKeys: AnonymousIdentityKeyring = {
      ...keyring(),
      encryptionKeys: new Map([[2, encryptionKeyV2]]),
    };

    expect(() => openAnonymousIdentity(envelope, missingVersionKeys)).toThrow(
      AnonymousIdentityError,
    );
    expect(() => sealAnonymousIdentity('   ', keyring())).toThrow(
      AnonymousIdentityError,
    );
  });
});

describe('anonymous identity fingerprinting and key loading', () => {
  it('documents separate Base64-encoded 32-byte production keys', () => {
    expect(environmentExample).toContain('ANONYMOUS_IDENTITY_KEY_V1');
    expect(environmentExample).toContain('ANONYMOUS_FINGERPRINT_KEY');
    expect(environmentExample).toMatch(/Base64-encoded 32-byte/i);
    expect(environmentExample).toMatch(/must be different/i);
  });

  it('creates a deterministic HMAC-SHA256 fingerprint without key versions', () => {
    const expected = createHmac('sha256', fingerprintKey)
      .update('user_123', 'utf8')
      .digest('hex');

    expect(fingerprintAnonymousUser('user_123', keyring())).toBe(expected);
    expect(fingerprintAnonymousUser('user_123', keyring())).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(
      fingerprintAnonymousUser('user_123', keyring(2, Buffer.alloc(32, 0x44))),
    ).not.toBe(expected);
    expect(fingerprintAnonymousUser('user_456', keyring())).not.toBe(expected);
  });

  it('loads distinct standard-base64 32-byte V1 and fingerprint keys', () => {
    const loaded = loadAnonymousIdentityKeyring({
      ANONYMOUS_FINGERPRINT_KEY: fingerprintKey.toString('base64'),
      ANONYMOUS_IDENTITY_KEY_V1: encryptionKeyV1.toString('base64'),
    });

    expect(loaded.currentVersion).toBe(1);
    expect(loaded.encryptionKeys.get(1)).toEqual(encryptionKeyV1);
    expect(loaded.fingerprintKey).toEqual(fingerprintKey);
  });

  it('can load an injected V1/V2 rotation keyring', () => {
    const loaded = loadAnonymousIdentityKeyring(
      {
        ANONYMOUS_FINGERPRINT_KEY: fingerprintKey.toString('base64'),
        ANONYMOUS_IDENTITY_KEY_V1: encryptionKeyV1.toString('base64'),
        ANONYMOUS_IDENTITY_KEY_V2: encryptionKeyV2.toString('base64'),
      },
      { currentVersion: 2, versions: [1, 2] },
    );

    expect([...loaded.encryptionKeys]).toEqual([
      [1, encryptionKeyV1],
      [2, encryptionKeyV2],
    ]);
  });

  it.each([
    ['invalid alphabet', '********************************'],
    ['surrounding whitespace', ` ${encryptionKeyV1.toString('base64')}`],
    [
      'non-canonical missing padding',
      encryptionKeyV1.toString('base64').replace(/=+$/, ''),
    ],
    ['31 decoded bytes', Buffer.alloc(31, 0x11).toString('base64')],
    ['33 decoded bytes', Buffer.alloc(33, 0x11).toString('base64')],
  ])('rejects %s without echoing the supplied secret', (_, invalidKey) => {
    const environment = {
      ANONYMOUS_FINGERPRINT_KEY: fingerprintKey.toString('base64'),
      ANONYMOUS_IDENTITY_KEY_V1: invalidKey,
    };

    expect(() => loadAnonymousIdentityKeyring(environment)).toThrow(
      AnonymousIdentityError,
    );
    try {
      loadAnonymousIdentityKeyring(environment);
    } catch (error) {
      expect(String(error)).not.toContain(invalidKey);
    }
  });

  it('rejects missing keys and equal encryption/fingerprint key values', () => {
    expect(() => loadAnonymousIdentityKeyring({})).toThrow(
      AnonymousIdentityError,
    );
    expect(() =>
      loadAnonymousIdentityKeyring({
        ANONYMOUS_FINGERPRINT_KEY: encryptionKeyV1.toString('base64'),
        ANONYMOUS_IDENTITY_KEY_V1: encryptionKeyV1.toString('base64'),
      }),
    ).toThrow(/different/i);
  });

  it('does not accept a structurally typed but malformed envelope', () => {
    const malformed = {
      ciphertext: '',
      iv: Buffer.alloc(12).toString('base64'),
      keyVersion: 1,
      tag: Buffer.alloc(16).toString('base64'),
    } as AnonymousIdentityEnvelope;

    expect(() => openAnonymousIdentity(malformed, keyring())).toThrow(
      AnonymousIdentityError,
    );
  });
});
