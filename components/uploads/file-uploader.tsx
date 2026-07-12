'use client';

import { useCallback, useRef, useState } from 'react';

import { validateUpload, type UploadKind } from '@/lib/validation/upload';

interface FileUploaderProps {
  kind: UploadKind;
  onReady: (assetId: string) => void;
}

interface UploadIntentResponse {
  assetId: string;
  contentType: string;
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
  MARKETPLACE_IMAGE: '.jpg,.jpeg,.png,.webp,.avif',
  RESOURCE_DOCUMENT: '.pdf,.docx,.pptx,.xlsx,.zip',
  RESOURCE_IMAGE: '.jpg,.jpeg,.png,.webp,.avif',
};

const labelsByKind: Record<UploadKind, string> = {
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
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<UploadIntentResponse>;
  return typeof candidate.assetId === 'string' &&
    typeof candidate.contentType === 'string' &&
    typeof candidate.uploadUrl === 'string'
    ? (candidate as UploadIntentResponse)
    : null;
}

function putFile(
  uploadUrl: string,
  contentType: string,
  file: File,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>,
  onProgress: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) {
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

export function FileUploader({ kind, onReady }: FileUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const upload = useCallback(
    async (selectedFile: File) => {
      const validation = validateUpload({
        contentType: selectedFile.type,
        fileName: selectedFile.name,
        kind,
        sizeBytes: selectedFile.size,
      });
      if (!validation.success) {
        setPhase('error');
        setMessage(validation.error.issues[0]?.message ?? 'Invalid file.');
        return;
      }

      const controller = new AbortController();
      requestRef.current = controller;
      setMessage('');
      setProgress(0);

      try {
        setPhase('requesting');
        const intentResponse = await fetch('/api/uploads/intent', {
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
        if (!intentResponse.ok) {
          throw new Error(
            await responseMessage(intentResponse, 'Unable to start upload.'),
          );
        }
        const intent = parseIntentResponse(await intentResponse.json());
        if (!intent || intent.contentType !== validation.data.contentType) {
          throw new Error('The server returned an invalid upload intent.');
        }

        setPhase('uploading');
        await putFile(
          intent.uploadUrl,
          intent.contentType,
          selectedFile,
          xhrRef,
          setProgress,
        );

        setPhase('completing');
        const completeResponse = await fetch('/api/uploads/complete', {
          body: JSON.stringify({ assetId: intent.assetId }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        });
        if (!completeResponse.ok) {
          throw new Error(
            await responseMessage(
              completeResponse,
              'Unable to complete upload.',
            ),
          );
        }
        const completed = (await completeResponse.json()) as {
          assetId?: unknown;
          status?: unknown;
        };
        if (
          completed.assetId !== intent.assetId ||
          completed.status !== 'READY'
        ) {
          throw new Error('The server did not confirm the uploaded asset.');
        }

        setPhase('ready');
        setMessage(`${validation.data.displayName} is ready.`);
        onReady(intent.assetId);
      } catch (error) {
        if (
          error instanceof UploadCancelledError ||
          controller.signal.aborted
        ) {
          setPhase('cancelled');
          setMessage('Upload cancelled.');
        } else {
          setPhase('error');
          setMessage(error instanceof Error ? error.message : 'Upload failed.');
        }
      } finally {
        requestRef.current = null;
      }
    },
    [kind, onReady],
  );

  const active =
    phase === 'requesting' || phase === 'uploading' || phase === 'completing';

  function cancel() {
    requestRef.current?.abort();
    xhrRef.current?.abort();
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
          setMessage('');
          setPhase('idle');
          setProgress(0);
          if (selectedFile) {
            void upload(selectedFile);
          }
        }}
        type="file"
      />

      <div className="h-2 overflow-hidden rounded-sm bg-slate-200">
        <div
          aria-hidden="true"
          className="h-full bg-blue-600 transition-[width]"
          style={{ width: `${phase === 'uploading' ? progress : 0}%` }}
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
            onClick={() => void upload(file)}
            type="button"
          >
            Retry
          </button>
        ) : null}
      </div>
    </section>
  );
}
