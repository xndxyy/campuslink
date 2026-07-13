import { describe, expect, it } from 'vitest';

import {
  beginUploadAttempt,
  createUploadAttemptState,
  isCurrentUploadAttempt,
  settleUploadAttempt,
} from '@/lib/uploads/attempt-state';

describe('upload attempt generations', () => {
  it('starts active and lets only the current generation settle', () => {
    const state = createUploadAttemptState();
    const first = beginUploadAttempt(state);

    expect(state.active).toBe(true);
    expect(isCurrentUploadAttempt(state, first)).toBe(true);

    const second = beginUploadAttempt(state);
    expect(isCurrentUploadAttempt(state, first)).toBe(false);
    expect(isCurrentUploadAttempt(state, second)).toBe(true);
    expect(settleUploadAttempt(state, first)).toBe(false);
    expect(state.active).toBe(true);
    expect(settleUploadAttempt(state, second)).toBe(true);
    expect(state.active).toBe(false);
  });

  it('drops a late ready callback from an older file selection', () => {
    const state = createUploadAttemptState();
    const readyAssets: string[] = [];
    const first = beginUploadAttempt(state);
    const second = beginUploadAttempt(state);

    if (isCurrentUploadAttempt(state, first)) readyAssets.push('asset_old');
    if (isCurrentUploadAttempt(state, second)) readyAssets.push('asset_new');

    expect(readyAssets).toStrictEqual(['asset_new']);
  });
});
