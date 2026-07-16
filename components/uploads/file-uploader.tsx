'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  fingerprintFile,
  getRecoveryAction,
  parseUploadRecovery,
  serializeUploadRecovery,
  type UploadRecovery,
  type UploadRecoveryPhase,
} from '@/lib/uploads/recovery';
import {
  beginUploadAttempt,
  createUploadAttemptState,
  finishUploadAttempt,
  invalidateUploadAttempts,
  isCurrentUploadAttempt,
  transitionUploadAttempt,
  type UploadActivePhase,
  type UploadAttemptCallbacks,
  type UploadAttemptPhase,
} from '@/lib/uploads/attempt-state';
import { validateUpload, type UploadKind } from '@/lib/validation/upload';

interface FileUploaderProps {
  kind: UploadKind;
  onActiveChange?: (active: boolean) => void;
  onReady: (assetId: string) => void;
  onSelectionStart?: () => void;
  onStateChange?: (phase: UploadPhase) => void;
}

interface UploadIntentResponse {
  assetId: string;
  contentType: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
  uploadUrl: string;
}

export type UploadPhase = UploadAttemptPhase;

const acceptsByKind: Record<UploadKind, string> = {
  ANNOUNCEMENT_IMAGE: '.jpg,.jpeg,.png,.webp,.avif',
  MARKETPLACE_IMAGE: '.jpg,.jpeg,.png,.webp,.avif',
  RESOURCE_DOCUMENT: '.pdf,.docx,.pptx,.xlsx,.zip',
  RESOURCE_IMAGE: '.jpg,.jpeg,.png,.webp,.avif',
};

const labelsByKind: Record<UploadKind, string> = {
  ANNOUNCEMENT_IMAGE: '公告封面图',
  MARKETPLACE_IMAGE: '二手物品图片',
  RESOURCE_DOCUMENT: '学习资料附件',
  RESOURCE_IMAGE: '学习资料图片',
};

class UploadCancelledError extends Error {}

async function responseMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    message?: unknown;
  } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}

function parseIntentResponse(value: unknown): UploadIntentResponse | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<UploadIntentResponse>;
  if (
    typeof candidate.assetId !== 'string' ||
    typeof candidate.contentType !== 'string' ||
    typeof candidate.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    !candidate.requiredHeaders ||
    typeof candidate.requiredHeaders !== 'object' ||
    Object.values(candidate.requiredHeaders).some(
      (header) => typeof header !== 'string',
    ) ||
    typeof candidate.uploadUrl !== 'string'
  ) {
    return null;
  }
  return candidate as UploadIntentResponse;
}

function putFile(
  recovery: UploadRecovery,
  file: File,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('PUT', recovery.uploadUrl);
    for (const [name, value] of Object.entries(recovery.requiredHeaders)) {
      if (name.toLowerCase() !== 'content-length') {
        xhr.setRequestHeader(name, value);
      }
    }
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhrRef.current === xhr) xhrRef.current = null;
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 412) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error('存储服务拒绝了本次上传。'));
      }
    });
    xhr.addEventListener('error', () => {
      if (xhrRef.current === xhr) xhrRef.current = null;
      reject(new Error('上传连接失败。'));
    });
    xhr.addEventListener('abort', () => {
      if (xhrRef.current === xhr) xhrRef.current = null;
      reject(new UploadCancelledError());
    });
    xhr.send(file);
  });
}

function abortActiveTransfers(
  controllersRef: React.MutableRefObject<Set<AbortController>>,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>,
) {
  for (const controller of controllersRef.current) controller.abort();
  controllersRef.current.clear();
  xhrRef.current?.abort();
}

export function FileUploader({
  kind,
  onActiveChange,
  onReady,
  onSelectionStart,
  onStateChange,
}: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const attemptStateRef = useRef(createUploadAttemptState());
  const controllersRef = useRef(new Set<AbortController>());
  const recoveryRef = useRef<UploadRecovery | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const recoveryKey = `campuslink:upload:${kind}`;
  const attemptCallbacks = useMemo<UploadAttemptCallbacks>(
    () => ({ onActiveChange, onReady, onSelectionStart, onStateChange }),
    [onActiveChange, onReady, onSelectionStart, onStateChange],
  );

  const saveRecovery = useCallback(
    (recovery: UploadRecovery | null) => {
      recoveryRef.current = recovery;
      try {
        if (recovery) {
          sessionStorage.setItem(
            recoveryKey,
            serializeUploadRecovery(recovery),
          );
        } else {
          sessionStorage.removeItem(recoveryKey);
        }
      } catch {
        // The in-memory recovery remains available if storage is unavailable.
      }
    },
    [recoveryKey],
  );

  useEffect(() => {
    const attemptState = attemptStateRef.current;
    try {
      recoveryRef.current = parseUploadRecovery(
        sessionStorage.getItem(recoveryKey),
      );
    } catch {
      recoveryRef.current = null;
    }

    return () => {
      invalidateUploadAttempts(attemptState);
      abortActiveTransfers(controllersRef, xhrRef);
    };
  }, [recoveryKey]);

  const runUpload = useCallback(
    async (selectedFile: File, generation: number) => {
      const isCurrent = () =>
        isCurrentUploadAttempt(attemptStateRef.current, generation);
      const setCurrentPhase = (nextPhase: UploadActivePhase) => {
        if (
          !transitionUploadAttempt(
            attemptStateRef.current,
            generation,
            nextPhase,
            attemptCallbacks,
          )
        ) {
          return false;
        }
        setPhase(nextPhase);
        return true;
      };
      const saveCurrentRecovery = (recovery: UploadRecovery | null) => {
        if (!isCurrent()) return false;
        saveRecovery(recovery);
        return true;
      };
      const finishAttempt = (
        nextPhase: 'ready' | 'cancelled' | 'error',
        nextMessage: string,
        readyAssetId?: string,
      ) => {
        if (
          !finishUploadAttempt(
            attemptStateRef.current,
            generation,
            { assetId: readyAssetId, phase: nextPhase },
            attemptCallbacks,
          )
        ) {
          return false;
        }
        setPhase(nextPhase);
        setMessage(nextMessage);
        return true;
      };

      const validation = validateUpload({
        contentType: selectedFile.type,
        fileName: selectedFile.name,
        kind,
        sizeBytes: selectedFile.size,
      });
      if (!validation.success) {
        finishAttempt(
          'error',
          validation.error.issues[0]?.message ?? '文件无效。',
        );
        return;
      }

      const createController = () => {
        const controller = new AbortController();
        controllersRef.current.add(controller);
        return controller;
      };
      const releaseController = (controller: AbortController) => {
        controllersRef.current.delete(controller);
      };
      const updateRecoveryPhase = (phaseValue: UploadRecoveryPhase) => {
        const recovery = recoveryRef.current;
        if (recovery) {
          saveCurrentRecovery({ ...recovery, phase: phaseValue });
        }
      };

      const completeIntent = async (): Promise<'ready' | 'concluded'> => {
        if (!isCurrent()) return 'concluded';
        const recovery = recoveryRef.current;
        if (!recovery) return 'concluded';
        updateRecoveryPhase('completing');
        setCurrentPhase('completing');
        const controller = createController();
        try {
          const response = await fetch('/api/uploads/complete', {
            body: JSON.stringify({ assetId: recovery.assetId }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
          });
          if (!isCurrent()) return 'concluded';
          if (response.status === 409) {
            saveCurrentRecovery(null);
            return 'concluded';
          }
          if (!response.ok) {
            throw new Error(await responseMessage(response, '无法完成上传。'));
          }
          const completed = (await response.json()) as {
            assetId?: unknown;
            status?: unknown;
          };
          if (!isCurrent()) return 'concluded';
          if (
            completed.assetId !== recovery.assetId ||
            completed.status !== 'READY'
          ) {
            throw new Error('服务器未确认已上传文件。');
          }
          saveCurrentRecovery(null);
          finishAttempt('ready', '文件上传完成。', recovery.assetId);
          return 'ready';
        } finally {
          releaseController(controller);
        }
      };

      const putAndComplete = async (selected: File) => {
        if (!isCurrent()) return;
        const recovery = recoveryRef.current;
        if (!recovery) throw new Error('上传任务已失效。');
        setCurrentPhase('uploading');
        await putFile(recovery, selected, xhrRef, (nextProgress) => {
          if (isCurrent()) setProgress(nextProgress);
        });
        if (!isCurrent()) return;
        updateRecoveryPhase('put-complete');
        await completeIntent();
      };

      const requestIntent = async (selected: File) => {
        if (!isCurrent()) return;
        setCurrentPhase('requesting');
        const controller = createController();
        try {
          const response = await fetch('/api/uploads/intent', {
            body: JSON.stringify({
              contentType: validation.data.contentType,
              fileName: validation.data.displayName,
              kind: validation.data.kind,
              sizeBytes: validation.data.sizeBytes,
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
          });
          if (!isCurrent()) return;
          if (!response.ok) {
            throw new Error(await responseMessage(response, '无法开始上传。'));
          }
          const intent = parseIntentResponse(await response.json());
          if (!intent || intent.contentType !== validation.data.contentType) {
            throw new Error('服务器返回了无效的上传任务。');
          }
          saveCurrentRecovery({
            ...intent,
            fileFingerprint: fingerprintFile(selected),
            phase: 'put-pending',
          });
        } finally {
          releaseController(controller);
        }
        if (isCurrent()) await putAndComplete(selected);
      };

      try {
        const fingerprint = fingerprintFile(selectedFile);
        if (
          recoveryRef.current &&
          recoveryRef.current.fileFingerprint !== fingerprint
        ) {
          saveCurrentRecovery(null);
        }
        const action = getRecoveryAction(
          recoveryRef.current,
          fingerprint,
          Date.now(),
        );
        if (action === 'request-intent') {
          await requestIntent(selectedFile);
          return;
        }
        if (action === 'put') {
          await putAndComplete(selectedFile);
          return;
        }

        const completion = await completeIntent();
        if (completion === 'concluded' && isCurrent()) {
          await requestIntent(selectedFile);
        }
      } catch (error) {
        if (
          error instanceof UploadCancelledError ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          finishAttempt('cancelled', '上传已取消，重试时会继续当前任务。');
        } else {
          finishAttempt(
            'error',
            error instanceof Error ? error.message : '上传失败。',
          );
        }
      }
    },
    [attemptCallbacks, kind, saveRecovery],
  );

  const startUpload = useCallback(
    (selectedFile: File, selectionStarted: boolean) => {
      abortActiveTransfers(controllersRef, xhrRef);
      const generation = beginUploadAttempt(
        attemptStateRef.current,
        attemptCallbacks,
        { selectionStarted },
      );
      setPhase('requesting');
      setMessage('');
      setProgress(0);
      void runUpload(selectedFile, generation);
    },
    [attemptCallbacks, runUpload],
  );

  const active =
    phase === 'requesting' || phase === 'uploading' || phase === 'completing';

  function cancel() {
    abortActiveTransfers(controllersRef, xhrRef);
  }

  return (
    <section
      aria-labelledby={`upload-${kind}-label`}
      className="w-full max-w-xl space-y-3"
    >
      <label
        className="block text-sm font-semibold text-slate-900"
        htmlFor={`upload-${kind}`}
        id={`upload-${kind}-label`}
      >
        {labelsByKind[kind]}
      </label>
      <input
        accept={acceptsByKind[kind]}
        className="block h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-transparent file:font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        disabled={active}
        id={`upload-${kind}`}
        onChange={(event) => {
          const selectedFile = event.target.files?.[0] ?? null;
          setFile(selectedFile);
          if (selectedFile) startUpload(selectedFile, true);
        }}
        type="file"
      />

      <div className="h-2 overflow-hidden rounded-sm bg-slate-200">
        <div
          aria-hidden="true"
          className="h-full bg-blue-600 transition-[width]"
          style={{
            width: `${phase === 'uploading' || phase === 'completing' ? progress : 0}%`,
          }}
        />
      </div>
      <div className="flex min-h-10 items-center justify-between gap-3">
        <p aria-live="polite" className="min-w-0 text-sm text-slate-700">
          {phase === 'uploading' ? `已上传 ${progress}%` : message}
        </p>
        {active ? (
          <button
            className="h-10 shrink-0 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
            onClick={cancel}
            type="button"
          >
            取消
          </button>
        ) : null}
        {(phase === 'error' || phase === 'cancelled') && file ? (
          <button
            className="h-10 shrink-0 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white"
            onClick={() => startUpload(file, false)}
            type="button"
          >
            重试
          </button>
        ) : null}
      </div>
    </section>
  );
}
