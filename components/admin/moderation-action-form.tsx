'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ModerationActionForm({
  action,
  label,
  subjectId,
  subjectType,
}: {
  action: 'APPROVE' | 'REJECT' | 'HIDE' | 'RESTORE' | 'ARCHIVE';
  label: string;
  subjectId: string;
  subjectType:
    | 'RESOURCE'
    | 'MARKETPLACE_ITEM'
    | 'JOB_POST'
    | 'FORUM_POST'
    | 'FORUM_COMMENT';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const titleId = `decision-${action}-${subjectId}`;

  async function submit(formData: FormData) {
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/moderation', {
        body: JSON.stringify({
          action,
          reason: formData.get('reason'),
          subjectId,
          subjectType,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? '操作失败。');
      setMessage('审核决定已记录。');
      dialog.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="admin-inline-action">
      <button type="button" onClick={() => dialog.current?.showModal()}>
        {label}
      </button>
      <dialog aria-labelledby={titleId} ref={dialog}>
        <form action={submit} className="admin-dialog-form">
          <p className="eyebrow">受审计的审核操作</p>
          <h2 id={titleId}>{label}</h2>
          <label>
            审核原因
            <textarea
              maxLength={1000}
              minLength={5}
              name="reason"
              required
              rows={5}
            />
          </label>
          <div className="dialog-actions">
            <button disabled={pending} type="submit">
              {pending ? '正在记录…' : `确认${label}`}
            </button>
            <button
              disabled={pending}
              onClick={() => dialog.current?.close()}
              type="button"
            >
              取消
            </button>
          </div>
        </form>
      </dialog>
      <span aria-live="polite" className="admin-action-message">
        {message}
      </span>
    </div>
  );
}
