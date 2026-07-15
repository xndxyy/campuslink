'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export interface ManagedBlockedWord {
  id: string;
  original: string;
  normalized: string;
  category: string;
  enabled: boolean;
}

async function mutate(body: Record<string, unknown>) {
  const response = await fetch('/api/admin/blocked-words', {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw new Error('操作失败，请检查输入后重试。');
}

export function BlockedWordManagement({
  items,
}: {
  items: ManagedBlockedWord[];
}) {
  const router = useRouter();
  const [category, setCategory] = useState('违规内容');
  const [original, setOriginal] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await mutate({ action: 'CREATE', category, original, reason });
      setOriginal('');
      setReason('');
      setMessage('已添加屏蔽词。');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    }
  }
  async function action(
    action: 'SET_ENABLED' | 'DELETE',
    id: string,
    enabled?: boolean,
  ) {
    const governanceReason = window.prompt('请输入治理原因（至少 5 个字符）');
    if (!governanceReason) return;
    try {
      await mutate(
        action === 'DELETE'
          ? { action: 'DELETE', id, reason: governanceReason }
          : { action: 'SET_ENABLED', id, enabled, reason: governanceReason },
      );
      router.refresh();
    } catch {
      setMessage('操作失败，请稍后重试。');
    }
  }
  return (
    <div className="blocked-word-management">
      <form onSubmit={(event) => void submit(event)}>
        <label>
          类别
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            required
          />
        </label>
        <label>
          屏蔽词
          <input
            value={original}
            onChange={(event) => setOriginal(event.target.value)}
            required
          />
        </label>
        <label>
          治理原因
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={5}
            required
          />
        </label>
        <button type="submit">添加</button>
      </form>
      {message ? <p role="status">{message}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.original}</strong> <span>{item.category}</span>{' '}
            <button
              onClick={() => void action('SET_ENABLED', item.id, !item.enabled)}
              type="button"
            >
              {item.enabled ? '停用' : '启用'}
            </button>
            <button
              onClick={() => void action('DELETE', item.id)}
              type="button"
            >
              永久删除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
