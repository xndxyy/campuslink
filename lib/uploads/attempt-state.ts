export type UploadActivePhase = 'requesting' | 'uploading' | 'completing';
export type UploadTerminalPhase = 'ready' | 'cancelled' | 'error';
export type UploadAttemptPhase =
  'idle' | UploadActivePhase | UploadTerminalPhase;

export interface UploadAttemptCallbacks {
  onActiveChange?: (active: boolean) => void;
  onReady?: (assetId: string) => void;
  onSelectionStart?: () => void;
  onStateChange?: (phase: UploadAttemptPhase) => void;
}

export interface UploadAttemptState {
  active: boolean;
  current: number;
  phase: UploadAttemptPhase;
}

export function createUploadAttemptState(): UploadAttemptState {
  return { active: false, current: 0, phase: 'idle' };
}

export function beginUploadAttempt(
  state: UploadAttemptState,
  callbacks: UploadAttemptCallbacks = {},
  options: { selectionStarted?: boolean } = {},
): number {
  state.current += 1;
  state.active = true;
  state.phase = 'requesting';
  if (options.selectionStarted) callbacks.onSelectionStart?.();
  callbacks.onActiveChange?.(true);
  callbacks.onStateChange?.('requesting');
  return state.current;
}

export function isCurrentUploadAttempt(
  state: UploadAttemptState,
  generation: number,
): boolean {
  return state.active && state.current === generation;
}

export function settleUploadAttempt(
  state: UploadAttemptState,
  generation: number,
): boolean {
  if (!isCurrentUploadAttempt(state, generation)) return false;
  state.active = false;
  return true;
}

export function transitionUploadAttempt(
  state: UploadAttemptState,
  generation: number,
  phase: UploadActivePhase,
  callbacks: UploadAttemptCallbacks = {},
): boolean {
  if (!isCurrentUploadAttempt(state, generation)) return false;
  state.phase = phase;
  callbacks.onStateChange?.(phase);
  return true;
}

export function finishUploadAttempt(
  state: UploadAttemptState,
  generation: number,
  outcome: { assetId?: string; phase: UploadTerminalPhase },
  callbacks: UploadAttemptCallbacks = {},
): boolean {
  if (!settleUploadAttempt(state, generation)) return false;
  state.phase = outcome.phase;
  callbacks.onStateChange?.(outcome.phase);
  callbacks.onActiveChange?.(false);
  if (outcome.phase === 'ready' && outcome.assetId) {
    callbacks.onReady?.(outcome.assetId);
  }
  return true;
}

export function invalidateUploadAttempts(state: UploadAttemptState): void {
  state.current += 1;
  state.active = false;
  state.phase = 'idle';
}
