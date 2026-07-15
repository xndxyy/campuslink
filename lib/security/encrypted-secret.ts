import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ivBytes = 12;
const tagBytes = 16;

export interface SecretEnvelope {
  ciphertext: string;
  iv: string;
  keyVersion: number;
  tag: string;
}
export class EncryptedSecretError extends Error {
  constructor() {
    super('Encrypted secret operation failed.');
    this.name = 'EncryptedSecretError';
  }
}

function checkedKey(key: Buffer | undefined) {
  if (!key || key.byteLength !== 32) throw new EncryptedSecretError();
  return key;
}
function aad(version: number) {
  if (!Number.isSafeInteger(version) || version < 1 || version > 0x7fff_ffff)
    throw new EncryptedSecretError();
  const value = Buffer.alloc(4);
  value.writeUInt32BE(version);
  return value;
}
function decode(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new EncryptedSecretError();
  const result = Buffer.from(value, 'base64');
  if (result.toString('base64') !== value) throw new EncryptedSecretError();
  return result;
}

function parseEnvelope(value: unknown): SecretEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new EncryptedSecretError();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 4 ||
    !['ciphertext', 'iv', 'keyVersion', 'tag'].every((key) =>
      Object.hasOwn(record, key),
    )
  )
    throw new EncryptedSecretError();
  const ciphertext = decode(record.ciphertext);
  const iv = decode(record.iv);
  const tag = decode(record.tag);
  aad(record.keyVersion as number);
  if (
    !ciphertext.length ||
    ciphertext.length > 4096 ||
    iv.length !== ivBytes ||
    tag.length !== tagBytes
  )
    throw new EncryptedSecretError();
  return record as unknown as SecretEnvelope;
}

export function sealSecret(
  plaintext: string,
  key: Buffer,
  keyVersion: number,
): SecretEnvelope {
  if (typeof plaintext !== 'string' || !plaintext || plaintext.length > 4096)
    throw new EncryptedSecretError();
  const iv = randomBytes(ivBytes);
  const cipher = createCipheriv('aes-256-gcm', checkedKey(key), iv, {
    authTagLength: tagBytes,
  });
  cipher.setAAD(aad(keyVersion));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    keyVersion,
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function openSecret(value: unknown, keys: ReadonlyMap<number, Buffer>) {
  const envelope = parseEnvelope(value);
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      checkedKey(keys.get(envelope.keyVersion)),
      Buffer.from(envelope.iv, 'base64'),
      { authTagLength: tagBytes },
    );
    decipher.setAAD(aad(envelope.keyVersion));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]),
    );
  } catch {
    throw new EncryptedSecretError();
  }
}

export function loadAiEncryptionKey(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const value = environment.AI_CONFIG_ENCRYPTION_KEY_V1;
  if (!value) throw new EncryptedSecretError();
  const key = decode(value);
  if (key.length !== 32) throw new EncryptedSecretError();
  return { currentVersion: 1, keys: new Map([[1, key]]) };
}
