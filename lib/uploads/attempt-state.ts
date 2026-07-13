export interface UploadAttemptState {
  active: boolean;
  current: number;
}

export function createUploadAttemptState(): UploadAttemptState {
  return { active: false, current: 0 };
}

export function beginUploadAttempt(state: UploadAttemptState): number {
  state.current += 1;
  state.active = true;
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

export function invalidateUploadAttempts(state: UploadAttemptState): void {
  state.current += 1;
  state.active = false;
}
