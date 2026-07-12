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
  subjectType: 'RESOURCE' | 'MARKETPLACE_ITEM' | 'JOB_POST';
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
      if (!response.ok) throw new Error(result.message ?? 'Decision failed.');
      setMessage('Decision recorded.');
      dialog.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Decision failed.');
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
          <p className="eyebrow">Audited decision</p>
          <h2 id={titleId}>{label}</h2>
          <label>
            Decision reason
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
              {pending ? 'Recording…' : `Confirm ${label}`}
            </button>
            <button
              disabled={pending}
              onClick={() => dialog.current?.close()}
              type="button"
            >
              Cancel
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
