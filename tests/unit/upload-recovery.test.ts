import { describe, expect, it } from 'vitest';

import {
  getRecoveryAction,
  parseUploadRecovery,
  serializeUploadRecovery,
  type UploadRecovery,
} from '@/lib/uploads/recovery';

const recovery: UploadRecovery = {
  assetId: 'asset_recovery',
  contentType: 'application/pdf',
  expiresAt: '2026-07-12T08:05:00.000Z',
  fileFingerprint: 'notes.pdf:1024:application/pdf:100',
  phase: 'put-pending',
  requiredHeaders: {
    'Content-Type': 'application/pdf',
    'If-None-Match': '*',
  },
  uploadUrl: 'https://storage.test/upload',
};

describe('upload recovery state', () => {
  it('requests a new intent only when no recovery exists', () => {
    expect(
      getRecoveryAction(null, recovery.fileFingerprint, Date.parse('2026-07-12T08:01:00Z')),
    ).toBe('request-intent');
  });

  it('reuses an unexpired PUT for the same file', () => {
    expect(
      getRecoveryAction(
        recovery,
        recovery.fileFingerprint,
        Date.parse('2026-07-12T08:01:00Z'),
      ),
    ).toBe('put');
  });

  it.each([
    [{ ...recovery, phase: 'put-complete' as const }, recovery.fileFingerprint],
    [{ ...recovery, phase: 'completing' as const }, recovery.fileFingerprint],
    [recovery, 'different.pdf:20:application/pdf:200'],
    [recovery, recovery.fileFingerprint],
  ])('completes the existing intent before allowing another', (state, fingerprint) => {
    const now =
      state === recovery && fingerprint === recovery.fileFingerprint
        ? Date.parse('2026-07-12T08:06:00Z')
        : Date.parse('2026-07-12T08:01:00Z');
    expect(getRecoveryAction(state, fingerprint, now)).toBe('complete');
  });

  it('round-trips only valid persisted recovery state', () => {
    expect(parseUploadRecovery(serializeUploadRecovery(recovery))).toEqual(
      recovery,
    );
    expect(parseUploadRecovery('{"assetId":1}')).toBeNull();
  });
});
