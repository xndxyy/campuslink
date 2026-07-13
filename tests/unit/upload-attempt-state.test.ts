import { describe, expect, it, vi } from 'vitest';

import {
  beginUploadAttempt,
  createUploadAttemptState,
  finishUploadAttempt,
  transitionUploadAttempt,
  type UploadAttemptCallbacks,
  type UploadTerminalPhase,
} from '@/lib/uploads/attempt-state';

function harness() {
  let coverAssetId: string | null = 'asset_previous';
  const activeChanges: boolean[] = [];
  const phases: string[] = [];
  const onReady = vi.fn((assetId: string) => {
    coverAssetId = assetId;
  });
  const callbacks: UploadAttemptCallbacks = {
    onActiveChange: (active) => activeChanges.push(active),
    onReady,
    onSelectionStart: () => {
      coverAssetId = null;
    },
    onStateChange: (phase) => phases.push(phase),
  };
  return {
    activeChanges,
    callbacks,
    cover: () => coverAssetId,
    onReady,
    phases,
  };
}

describe('upload attempt orchestration', () => {
  it('ignores an old delayed ready and old settle after a new selection', () => {
    const state = createUploadAttemptState();
    const events = harness();
    const first = beginUploadAttempt(state, events.callbacks, {
      selectionStarted: true,
    });
    transitionUploadAttempt(state, first, 'uploading', events.callbacks);
    const second = beginUploadAttempt(state, events.callbacks, {
      selectionStarted: true,
    });

    expect(
      finishUploadAttempt(
        state,
        first,
        { assetId: 'asset_old', phase: 'ready' },
        events.callbacks,
      ),
    ).toBe(false);
    expect(state.active).toBe(true);
    expect(events.cover()).toBeNull();
    expect(events.onReady).not.toHaveBeenCalled();

    transitionUploadAttempt(state, second, 'completing', events.callbacks);
    expect(
      finishUploadAttempt(
        state,
        second,
        { assetId: 'asset_new', phase: 'ready' },
        events.callbacks,
      ),
    ).toBe(true);
    expect(state.active).toBe(false);
    expect(events.cover()).toBe('asset_new');
    expect(events.onReady).toHaveBeenCalledOnce();
    expect(events.onReady).toHaveBeenCalledWith('asset_new');
    expect(events.activeChanges).toStrictEqual([true, true, false]);
    expect(events.phases).toStrictEqual([
      'requesting',
      'uploading',
      'requesting',
      'completing',
      'ready',
    ]);

    expect(
      finishUploadAttempt(
        state,
        second,
        { assetId: 'asset_duplicate', phase: 'ready' },
        events.callbacks,
      ),
    ).toBe(false);
    expect(events.onReady).toHaveBeenCalledOnce();
  });

  it.each(['cancelled', 'error'] as UploadTerminalPhase[])(
    '%s followed by retry uses a new generation and releases active state',
    (terminalPhase) => {
      const state = createUploadAttemptState();
      const events = harness();
      const failed = beginUploadAttempt(state, events.callbacks, {
        selectionStarted: true,
      });

      expect(
        finishUploadAttempt(
          state,
          failed,
          { phase: terminalPhase },
          events.callbacks,
        ),
      ).toBe(true);
      expect(state.active).toBe(false);
      expect(events.cover()).toBeNull();
      expect(events.onReady).not.toHaveBeenCalled();

      const retry = beginUploadAttempt(state, events.callbacks, {
        selectionStarted: false,
      });
      expect(retry).toBeGreaterThan(failed);
      transitionUploadAttempt(state, retry, 'uploading', events.callbacks);
      expect(
        finishUploadAttempt(
          state,
          retry,
          { assetId: 'asset_retry', phase: 'ready' },
          events.callbacks,
        ),
      ).toBe(true);
      expect(state.active).toBe(false);
      expect(events.cover()).toBe('asset_retry');
      expect(events.onReady).toHaveBeenCalledOnce();
      expect(events.activeChanges).toStrictEqual([true, false, true, false]);
      expect(events.phases.at(-1)).toBe('ready');
    },
  );
});
