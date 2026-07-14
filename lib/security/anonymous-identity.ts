import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const MAX_KEY_VERSION = 0xffff_ffff;
const standardBase64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface AnonymousIdentityEnvelope {
  ciphertext: string;
  iv: string;
  keyVersion: number;
  tag: string;
}

export interface AnonymousIdentityKeyring {
  currentVersion: number;
  encryptionKeys: ReadonlyMap<number, Buffer>;
  fingerprintKey: Buffer;
}

type AnonymousIdentityEnvironment = Readonly<
  Record<string, string | undefined>
>;

export class AnonymousIdentityError extends Error {
  constructor(
    public readonly code:
      | 'DECRYPTION_FAILED'
      | 'INVALID_CONFIGURATION'
      | 'INVALID_IDENTITY'
      | 'MALFORMED_ENVELOPE'
      | 'UNKNOWN_KEY_VERSION',
    message = 'Anonymous identity operation failed.',
  ) {
    super(message);
    this.name = 'AnonymousIdentityError';
  }
}

function validKeyVersion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_KEY_VERSION
  );
}

function keyVersionAad(version: number) {
  if (!validKeyVersion(version)) {
    throw new AnonymousIdentityError(
      'INVALID_CONFIGURATION',
      'Anonymous identity key version is invalid.',
    );
  }
  const aad = Buffer.alloc(4);
  aad.writeUInt32BE(version);
  return aad;
}

function decodeStandardBase64(
  value: unknown,
  code: 'INVALID_CONFIGURATION' | 'MALFORMED_ENVELOPE',
) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !standardBase64.test(value)
  ) {
    throw new AnonymousIdentityError(code);
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw new AnonymousIdentityError(code);
  }
  return decoded;
}

function decodedKey(value: string | undefined, name: string) {
  if (!value) {
    throw new AnonymousIdentityError(
      'INVALID_CONFIGURATION',
      `${name} is required.`,
    );
  }
  const key = decodeStandardBase64(value, 'INVALID_CONFIGURATION');
  if (key.byteLength !== AES_KEY_BYTES) {
    throw new AnonymousIdentityError(
      'INVALID_CONFIGURATION',
      `${name} must decode to exactly 32 bytes.`,
    );
  }
  return key;
}

function validIdentity(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 191 &&
    value.trim() === value
  );
}

function checkedKey(key: Buffer | undefined, version: number) {
  if (!key) {
    throw new AnonymousIdentityError(
      'UNKNOWN_KEY_VERSION',
      'Anonymous identity key version is unavailable.',
    );
  }
  if (key.byteLength !== AES_KEY_BYTES) {
    throw new AnonymousIdentityError(
      'INVALID_CONFIGURATION',
      'Anonymous identity encryption key is invalid.',
    );
  }
  keyVersionAad(version);
  return key;
}

function checkedFingerprintKey(keyring: AnonymousIdentityKeyring) {
  if (keyring.fingerprintKey.byteLength !== AES_KEY_BYTES) {
    throw new AnonymousIdentityError(
      'INVALID_CONFIGURATION',
      'Anonymous fingerprint key is invalid.',
    );
  }
  for (const key of keyring.encryptionKeys.values()) {
    if (
      key.byteLength === AES_KEY_BYTES &&
      key.equals(keyring.fingerprintKey)
    ) {
      throw new AnonymousIdentityError(
        'INVALID_CONFIGURATION',
        'Anonymous identity and fingerprint keys must be different.',
      );
    }
  }
  return keyring.fingerprintKey;
}

export function parseAnonymousIdentityEnvelope(
  value: unknown,
): AnonymousIdentityEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AnonymousIdentityError('MALFORMED_ENVELOPE');
  }
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'ciphertext,iv,keyVersion,tag') {
    throw new AnonymousIdentityError('MALFORMED_ENVELOPE');
  }
  const record = value as Record<string, unknown>;
  if (!validKeyVersion(record.keyVersion)) {
    throw new AnonymousIdentityError('MALFORMED_ENVELOPE');
  }
  const ciphertext = decodeStandardBase64(
    record.ciphertext,
    'MALFORMED_ENVELOPE',
  );
  const iv = decodeStandardBase64(record.iv, 'MALFORMED_ENVELOPE');
  const tag = decodeStandardBase64(record.tag, 'MALFORMED_ENVELOPE');
  if (
    ciphertext.byteLength === 0 ||
    iv.byteLength !== GCM_IV_BYTES ||
    tag.byteLength !== GCM_TAG_BYTES
  ) {
    throw new AnonymousIdentityError('MALFORMED_ENVELOPE');
  }
  return {
    ciphertext: record.ciphertext as string,
    iv: record.iv as string,
    keyVersion: record.keyVersion,
    tag: record.tag as string,
  };
}

export function serializeAnonymousIdentityEnvelope(value: unknown) {
  return JSON.stringify(parseAnonymousIdentityEnvelope(value));
}

export function sealAnonymousIdentity(
  userId: string,
  keyring: AnonymousIdentityKeyring,
  keyVersion = keyring.currentVersion,
): AnonymousIdentityEnvelope {
  if (!validIdentity(userId)) {
    throw new AnonymousIdentityError(
      'INVALID_IDENTITY',
      'Anonymous identity value is invalid.',
    );
  }
  checkedFingerprintKey(keyring);
  const key = checkedKey(keyring.encryptionKeys.get(keyVersion), keyVersion);
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: GCM_TAG_BYTES,
  });
  cipher.setAAD(keyVersionAad(keyVersion));
  const ciphertext = Buffer.concat([
    cipher.update(userId, 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    keyVersion,
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function openAnonymousIdentity(
  value: unknown,
  keyring: AnonymousIdentityKeyring,
) {
  const envelope = parseAnonymousIdentityEnvelope(value);
  checkedFingerprintKey(keyring);
  const key = checkedKey(
    keyring.encryptionKeys.get(envelope.keyVersion),
    envelope.keyVersion,
  );
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64'),
      { authTagLength: GCM_TAG_BYTES },
    );
    decipher.setAAD(keyVersionAad(envelope.keyVersion));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    const userId = new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    if (!validIdentity(userId)) throw new Error('invalid identity');
    return userId;
  } catch {
    throw new AnonymousIdentityError(
      'DECRYPTION_FAILED',
      'Anonymous identity could not be authenticated.',
    );
  }
}

export function fingerprintAnonymousUser(
  userId: string,
  keyring: AnonymousIdentityKeyring,
) {
  if (!validIdentity(userId)) {
    throw new AnonymousIdentityError(
      'INVALID_IDENTITY',
      'Anonymous identity value is invalid.',
    );
  }
  return createHmac('sha256', checkedFingerprintKey(keyring))
    .update(userId, 'utf8')
    .digest('hex');
}

export function loadAnonymousIdentityKeyring(
  environment: AnonymousIdentityEnvironment = process.env,
  options: { currentVersion?: number; versions?: readonly number[] } = {},
): AnonymousIdentityKeyring {
  const currentVersion = options.currentVersion ?? 1;
  const versions = options.versions ?? [1];
  if (
    !validKeyVersion(currentVersion) ||
    versions.length === 0 ||
    versions.some((version) => !validKeyVersion(version)) ||
    new Set(versions).size !== versions.length ||
    !versions.includes(currentVersion)
  ) {
    throw new AnonymousIdentityError(
      'INVALID_CONFIGURATION',
      'Anonymous identity key versions are invalid.',
    );
  }

  const encryptionKeys = new Map<number, Buffer>();
  for (const version of versions) {
    const name = `ANONYMOUS_IDENTITY_KEY_V${version}`;
    encryptionKeys.set(version, decodedKey(environment[name], name));
  }
  const loaded: AnonymousIdentityKeyring = {
    currentVersion,
    encryptionKeys,
    fingerprintKey: decodedKey(
      environment.ANONYMOUS_FINGERPRINT_KEY,
      'ANONYMOUS_FINGERPRINT_KEY',
    ),
  };
  checkedFingerprintKey(loaded);
  return loaded;
}
