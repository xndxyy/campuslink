export type UploadRecoveryPhase = 'put-pending' | 'put-complete' | 'completing';

export interface UploadRecovery {
  assetId: string;
  contentType: string;
  expiresAt: string;
  fileFingerprint: string;
  phase: UploadRecoveryPhase;
  requiredHeaders: Record<string, string>;
  uploadUrl: string;
}

export type UploadRecoveryAction = 'request-intent' | 'put' | 'complete';

export function fingerprintFile(
  file: Pick<File, 'lastModified' | 'name' | 'size' | 'type'>,
): string {
  return `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
}

export function getRecoveryAction(
  recovery: UploadRecovery | null,
  fileFingerprint: string,
  nowMs = Date.now(),
): UploadRecoveryAction {
  if (!recovery) {
    return 'request-intent';
  }
  if (
    recovery.phase === 'put-pending' &&
    recovery.fileFingerprint === fileFingerprint &&
    Date.parse(recovery.expiresAt) > nowMs
  ) {
    return 'put';
  }
  return 'complete';
}

export function serializeUploadRecovery(recovery: UploadRecovery): string {
  return JSON.stringify(recovery);
}

export function parseUploadRecovery(
  value: string | null,
): UploadRecovery | null {
  if (!value) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(value);
  } catch {
    return null;
  }
  if (!candidate || typeof candidate !== 'object') return null;
  const state = candidate as Partial<UploadRecovery>;
  if (
    typeof state.assetId !== 'string' ||
    typeof state.contentType !== 'string' ||
    typeof state.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(state.expiresAt)) ||
    typeof state.fileFingerprint !== 'string' ||
    (state.phase !== 'put-pending' &&
      state.phase !== 'put-complete' &&
      state.phase !== 'completing') ||
    !state.requiredHeaders ||
    typeof state.requiredHeaders !== 'object' ||
    Object.values(state.requiredHeaders).some(
      (header) => typeof header !== 'string',
    ) ||
    typeof state.uploadUrl !== 'string'
  ) {
    return null;
  }
  return state as UploadRecovery;
}
