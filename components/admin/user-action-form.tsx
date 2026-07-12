'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function UserActionForm({
  currentRole,
  currentStatus,
  userId,
}: {
  currentRole: string;
  currentStatus: string;
  userId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const titleId = `manage-user-${userId}`;

  async function submit(formData: FormData) {
    setPending(true);
    setMessage('');
    try {
      const field = String(formData.get('field'));
      const value = String(formData.get(field));
      const response = await fetch('/api/admin/users', {
        body: JSON.stringify({
          [field]: value,
          reason: formData.get('reason'),
          userId,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(result.message ?? 'User change failed.');
      setMessage('User change recorded.');
      dialog.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'User change failed.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="admin-inline-action">
      <button type="button" onClick={() => dialog.current?.showModal()}>
        Manage
      </button>
      <dialog aria-labelledby={titleId} ref={dialog}>
        <form action={submit} className="admin-dialog-form">
          <p className="eyebrow">Administrator only</p>
          <h2 id={titleId}>Manage user</h2>
          <label>
            Property
            <select defaultValue="role" name="field">
              <option value="role">Role</option>
              <option value="status">Account status</option>
            </select>
          </label>
          <label>
            Role (current: {currentRole})
            <select defaultValue={currentRole} name="role">
              <option value="STUDENT">Student</option>
              <option value="MODERATOR">Moderator</option>
              <option value="ADMIN">Administrator</option>
            </select>
          </label>
          <label>
            Status (current: {currentStatus})
            <select defaultValue={currentStatus} name="status">
              <option value="PENDING_VERIFICATION">Pending verification</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </label>
          <label>
            Required reason
            <textarea
              maxLength={1000}
              minLength={5}
              name="reason"
              required
              rows={4}
            />
          </label>
          <div className="dialog-actions">
            <button disabled={pending} type="submit">
              {pending ? 'Saving…' : 'Save change'}
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
