'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function ReportActionForm({
  reportId,
  status,
}: {
  reportId: string;
  status: 'OPEN' | 'TRIAGED';
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const titleId = `report-decision-${reportId}`;

  async function submit(formData: FormData) {
    setPending(true);
    setMessage('');
    try {
      const action = String(formData.get('action'));
      const response = await fetch('/api/admin/reports', {
        body: JSON.stringify({
          action,
          ...(action === 'RESOLVE'
            ? { hideTarget: formData.get('hideTarget') === 'on' }
            : {}),
          reason: formData.get('reason'),
          reportId,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(result.message ?? 'Report action failed.');
      setMessage('Report outcome recorded.');
      dialog.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Report action failed.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="admin-inline-action">
      <button type="button" onClick={() => dialog.current?.showModal()}>
        Review report
      </button>
      <dialog aria-labelledby={titleId} ref={dialog}>
        <form action={submit} className="admin-dialog-form">
          <p className="eyebrow">Neutral reporter outcome</p>
          <h2 id={titleId}>Resolve report</h2>
          <label>
            Outcome
            <select
              defaultValue={status === 'OPEN' ? 'TRIAGE' : 'RESOLVE'}
              name="action"
            >
              {status === 'OPEN' ? (
                <option value="TRIAGE">Triage and assign to me</option>
              ) : (
                <>
                  <option value="RESOLVE">Resolve</option>
                  <option value="DISMISS">Dismiss</option>
                </>
              )}
            </select>
          </label>
          <label>
            Resolution reason
            <textarea
              maxLength={1000}
              minLength={5}
              name="reason"
              required
              rows={5}
            />
          </label>
          <label className="checkbox-label">
            <input name="hideTarget" type="checkbox" />
            Hide the published target when resolving
          </label>
          <div className="dialog-actions">
            <button disabled={pending} type="submit">
              {pending ? 'Recording…' : 'Record outcome'}
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
