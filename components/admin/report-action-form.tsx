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
        throw new Error(result.message ?? '举报处理失败。');
      setMessage('举报处理结果已记录。');
      dialog.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '举报处理失败。',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="admin-inline-action">
      <button type="button" onClick={() => dialog.current?.showModal()}>
        处理举报
      </button>
      <dialog aria-labelledby={titleId} ref={dialog}>
        <form action={submit} className="admin-dialog-form">
          <p className="eyebrow">中立处理结果</p>
          <h2 id={titleId}>处理举报</h2>
          <label>
            处理方式
            <select
              defaultValue={status === 'OPEN' ? 'TRIAGE' : 'RESOLVE'}
              name="action"
            >
              {status === 'OPEN' ? (
                <option value="TRIAGE">标记处理中并分配给我</option>
              ) : (
                <>
                  <option value="RESOLVE">确认举报</option>
                  <option value="DISMISS">驳回举报</option>
                </>
              )}
            </select>
          </label>
          <label>
            处理原因
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
            确认举报时隐藏已发布内容
          </label>
          <div className="dialog-actions">
            <button disabled={pending} type="submit">
              {pending ? '记录中...' : '记录处理结果'}
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
