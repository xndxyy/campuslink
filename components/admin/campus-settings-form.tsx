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
        throw new Error(result.message ?? '设置更新失败。');
      setMessage('校区设置已更新并写入审计日志。');
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '设置更新失败。',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={submit} className="admin-settings-form">
      <label>
        校区名称
        <input
          defaultValue={name}
          maxLength={200}
          minLength={2}
          name="name"
          required
        />
      </label>
      <label>
        变更原因
        <textarea
          maxLength={1000}
          minLength={5}
          name="reason"
          required
          rows={4}
        />
      </label>
      <button disabled={pending} type="submit">
        {pending ? '保存中...' : '保存设置'}
      </button>
      <p aria-live="polite" className="admin-action-message">
        {message}
      </p>
    </form>
  );
}
