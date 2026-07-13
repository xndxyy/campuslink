'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CampusSettingsForm({ name }: { name: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(formData: FormData) {
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/settings', {
        body: JSON.stringify({
          name: formData.get('name'),
          reason: formData.get('reason'),
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(result.message ?? 'Settings change failed.');
      setMessage('Campus settings updated and audited.');
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Settings change failed.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={submit} className="admin-settings-form">
      <label>
        Campus name
        <input
          defaultValue={name}
          maxLength={200}
          minLength={2}
          name="name"
          required
        />
      </label>
      <label>
        Change reason
        <textarea
          maxLength={1000}
          minLength={5}
          name="reason"
          required
          rows={4}
        />
      </label>
      <button disabled={pending} type="submit">
        {pending ? 'Saving…' : 'Save audited settings'}
      </button>
      <p aria-live="polite" className="admin-action-message">
        {message}
      </p>
    </form>
  );
}
