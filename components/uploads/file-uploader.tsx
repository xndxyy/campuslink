'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fingerprintFile,
  getRecoveryAction,
  parseUploadRecovery,
  serializeUploadRecovery,
  type UploadRecovery,
  type UploadRecoveryPhase,
} from '@/lib/uploads/recovery';
import { validateUpload, type UploadKind } from '@/lib/validation/upload';

interface FileUploaderProps {
  kind: UploadKind;
  onReady: (assetId: string) => void;
}

interface UploadIntentResponse {
  assetId: string;
  contentType: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>;
  uploadUrl: string;
}

type UploadPhase =
  | 'idle'
  | 'requesting'
  | 'uploading'
  | 'completing'
  | 'ready'
  | 'cancelled'
  | 'error';

const acceptsByKind: Record<UploadKind, string> = {
  ANNOUNCEMENT_IMAGE: '.jpg,.jpeg,.png,.webp,.avif',
  MARKETPLACE_IMAGE: '.jpg,.jpeg,.png,.webp,.avif',
  RESOURCE_DOCUMENT: '.pdf,.docx,.pptx,.xlsx,.zip',
  RESOURCE_IMAGE: '.jpg,.jpeg,.png,.webp,.avif',
};

const labelsByKind: Record<UploadKind, string> = {
  ANNOUNCEMENT_IMAGE: '公告封面图',
  MARKETPLACE_IMAGE: 'Marketplace image',
  RESOURCE_DOCUMENT: 'Resource document',
  RESOURCE_IMAGE: 'Resource image',
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
      xhrRef.current = null;
      if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 412) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error('Storage rejected the upload.'));
      }
    });
    xhr.addEventListener('error', () => {
      xhrRef.current = null;
      reject(new Error('The upload connection failed.'));
    });
    xhr.addEventListener('abort', () => {
      xhrRef.current = null;
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

export function FileUploader({ kind, onReady }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const controllersRef = useRef(new Set<AbortController>());
  const recoveryRef = useRef<UploadRecovery | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const recoveryKey = `campuslink:upload:${kind}`;

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
    try {
      recoveryRef.current = parseUploadRecovery(
        sessionStorage.getItem(recoveryKey),
      );
    } catch {
      recoveryRef.current = null;
    }

    return () => {
      abortActiveTransfers(controllersRef, xhrRef);
    };
  }, [recoveryKey]);

  const runUpload = useCallback(
    async (selectedFile: File | null) => {
      const validation = selectedFile
        ? validateUpload({
            contentType: selectedFile.type,
            fileName: selectedFile.name,
            kind,
            sizeBytes: selectedFile.size,
          })
        : null;
      if (validation && !validation.success) {
        setPhase('error');
        setMessage(validation.error.issues[0]?.message ?? 'Invalid file.');
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
        if (recovery) saveRecovery({ ...recovery, phase: phaseValue });
      };

      const completeIntent = async (): Promise<'ready' | 'concluded'> => {
        const recovery = recoveryRef.current;
        if (!recovery) return 'concluded';
        updateRecoveryPhase('completing');
        setPhase('completing');
        const controller = createController();
        try {
          const response = await fetch('/api/uploads/complete', {
            body: JSON.stringify({ assetId: recovery.assetId }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
          });
          if (response.status === 409) {
            saveRecovery(null);
            return 'concluded';
          }
          if (!response.ok) {
            throw new Error(
              await responseMessage(response, 'Unable to complete upload.'),
            );
          }
          const completed = (await response.json()) as {
            assetId?: unknown;
            status?: unknown;
          };
          if (
            completed.assetId !== recovery.assetId ||
            completed.status !== 'READY'
          ) {
            throw new Error('The server did not confirm the uploaded asset.');
          }
          saveRecovery(null);
          setPhase('ready');
          setMessage('Upload is ready.');
          onReady(recovery.assetId);
          return 'ready';
        } finally {
          releaseController(controller);
        }
      };

      const putAndComplete = async (selected: File) => {
        const recovery = recoveryRef.current;
        if (!recovery) throw new Error('Upload intent is unavailable.');
        setPhase('uploading');
        await putFile(recovery, selected, xhrRef, setProgress);
        updateRecoveryPhase('put-complete');
        await completeIntent();
      };

      const requestIntent = async (selected: File) => {
        if (!validation?.success) return;
        setPhase('requesting');
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
          if (!response.ok) {
            throw new Error(
              await responseMessage(response, 'Unable to start upload.'),
            );
          }
          const intent = parseIntentResponse(await response.json());
          if (!intent || intent.contentType !== validation.data.contentType) {
            throw new Error('The server returned an invalid upload intent.');
          }
          saveRecovery({
            ...intent,
            fileFingerprint: fingerprintFile(selected),
            phase: 'put-pending',
          });
        } finally {
          releaseController(controller);
        }
        await putAndComplete(selected);
      };

      setMessage('');
      setProgress(0);
      try {
        const fingerprint = selectedFile ? fingerprintFile(selectedFile) : '';
        const action = getRecoveryAction(
          recoveryRef.current,
          fingerprint,
          Date.now(),
        );
        if (action === 'request-intent') {
          if (selectedFile) await requestIntent(selectedFile);
          return;
        }
        if (action === 'put') {
          if (!selectedFile) {
            setPhase('error');
            setMessage('Select the original file to resume the upload.');
            return;
          }
          await putAndComplete(selectedFile);
          return;
        }

        const completion = await completeIntent();
        if (completion === 'concluded' && selectedFile) {
          await requestIntent(selectedFile);
        }
      } catch (error) {
        if (
          error instanceof UploadCancelledError ||
          (error instanceof DOMException && error.name === 'AbortError')
        ) {
          setPhase('cancelled');
          setMessage('Upload cancelled. Retry will resume this intent.');
        } else {
          setPhase('error');
          setMessage(error instanceof Error ? error.message : 'Upload failed.');
        }
      }
    },
    [kind, onReady, saveRecovery],
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
          if (selectedFile) void runUpload(selectedFile);
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
          {phase === 'uploading' ? `${progress}% uploaded` : message}
        </p>
        {active ? (
          <button
            className="h-10 shrink-0 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
            onClick={cancel}
            type="button"
          >
            Cancel
          </button>
        ) : null}
        {(phase === 'error' || phase === 'cancelled') && file ? (
          <button
            className="h-10 shrink-0 rounded-md bg-slate-900 px-4 text-sm font-semibold text-white"
            onClick={() => void runUpload(file)}
            type="button"
          >
            Retry
          </button>
        ) : null}
      </div>
    </section>
  );
}
