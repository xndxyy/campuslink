'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function OwnerActions({
  id,
  kind,
  status,
}: {
  id: string;
  kind: 'resource' | 'marketplace' | 'campus-work';
  status: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const endpoint =
    kind === 'resource'
      ? 'resources'
      : kind === 'marketplace'
        ? 'marketplace'
        : 'campus-work';
  async function act(action: 'archive' | 'submit') {
    setPending(true);
    setMessage('');
    const response = await fetch(`/api/${endpoint}/${id}`, {
      body: JSON.stringify({ action }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    });
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    if (!response.ok) setMessage(body?.message ?? '操作失败，请重试。');
    else {
      setMessage('状态已更新。');
      router.refresh();
    }
    setPending(false);
  }
  return (
    <div className="owner-actions">
      {status === 'DRAFT' || status === 'REJECTED' ? (
        <Link href={`/me/submissions/${kind}/${id}/edit`}>编辑</Link>
      ) : null}
      {status === 'DRAFT' ? (
        <button
          disabled={pending}
          onClick={() => void act('submit')}
          type="button"
        >
          重新提交
        </button>
      ) : null}
      {status === 'PENDING' || status === 'PUBLISHED' ? (
        <button
          disabled={pending}
          onClick={() => void act('archive')}
          type="button"
        >
          归档
        </button>
      ) : null}
      <span aria-live="polite">{message}</span>
    </div>
  );
}
