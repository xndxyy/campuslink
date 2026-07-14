'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import type { TagScope } from '@/lib/validation/tags';

export interface ManagedTagItem {
  id: string;
  isActive: boolean;
  isPreset: boolean;
  label: string;
}

interface TagManagementProps {
  items: ManagedTagItem[];
  scope: TagScope;
}

async function sendMutation(body: Record<string, unknown>) {
  const response = await fetch('/api/admin/tags', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(result?.message ?? '操作失败，请稍后重试。');
  }
}

function TagRowActions({
  item,
  scope,
}: {
  item: ManagedTagItem;
  scope: TagScope;
}) {
  const activeDialog = useRef<HTMLDialogElement>(null);
  const promoteDialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState('');

  async function mutate(
    event: FormEvent<HTMLFormElement>,
    action: 'SET_ACTIVE' | 'PROMOTE_CUSTOM',
  ) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage('正在提交…');
    try {
      await sendMutation(
        action === 'SET_ACTIVE'
          ? {
              action: 'SET_ACTIVE',
              active: !item.isActive,
              reason,
              scope,
              tagId: item.id,
            }
          : {
              action: 'PROMOTE_CUSTOM',
              reason,
              scope,
              tagId: item.id,
            },
      );
      setMessage('操作已完成。');
      setReason('');
      activeDialog.current?.close();
      promoteDialog.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '操作失败，请稍后重试。',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="tag-row-actions">
      <label className="tag-active-toggle">
        <input
          checked={item.isActive}
          disabled={pending}
          onChange={() => activeDialog.current?.showModal()}
          role="switch"
          type="checkbox"
        />
        <span>{item.isActive ? '已启用' : '已停用'}</span>
      </label>
      {!item.isPreset ? (
        <button
          disabled={pending}
          onClick={() => promoteDialog.current?.showModal()}
          type="button"
        >
          提升为预设
        </button>
      ) : null}

      <dialog aria-labelledby={`status-${item.id}`} ref={activeDialog}>
        <form
          className="tag-action-dialog"
          onSubmit={(event) => void mutate(event, 'SET_ACTIVE')}
        >
          <h2 id={`status-${item.id}`}>
            {item.isActive ? '停用' : '启用'}“{item.label}”
          </h2>
          <p>历史内容仍会保留此标签定义。</p>
          <label>
            治理原因
            <textarea
              disabled={pending}
              maxLength={1000}
              minLength={5}
              name="reason"
              onChange={(event) => setReason(event.target.value)}
              required
              rows={4}
              value={reason}
            />
          </label>
          <div className="dialog-actions">
            <button
              disabled={pending}
              onClick={() => activeDialog.current?.close()}
              type="button"
            >
              取消
            </button>
            <button disabled={pending} type="submit">
              {pending ? '提交中…' : '确认变更'}
            </button>
          </div>
        </form>
      </dialog>

      {!item.isPreset ? (
        <dialog aria-labelledby={`promote-${item.id}`} ref={promoteDialog}>
          <form
            className="tag-action-dialog"
            onSubmit={(event) => void mutate(event, 'PROMOTE_CUSTOM')}
          >
            <h2 id={`promote-${item.id}`}>提升“{item.label}”为预设</h2>
            <p>提升不会改变当前启用状态。</p>
            <label>
              治理原因
              <textarea
                disabled={pending}
                maxLength={1000}
                minLength={5}
                name="reason"
                onChange={(event) => setReason(event.target.value)}
                required
                rows={4}
                value={reason}
              />
            </label>
            <div className="dialog-actions">
              <button
                disabled={pending}
                onClick={() => promoteDialog.current?.close()}
                type="button"
              >
                取消
              </button>
              <button disabled={pending} type="submit">
                {pending ? '提交中…' : '确认提升'}
              </button>
            </div>
          </form>
        </dialog>
      ) : null}
      <p aria-live="polite" className="tag-row-message">
        {message}
      </p>
    </div>
  );
}

export function TagManagement({ items, scope }: TagManagementProps) {
  const router = useRouter();
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState('');

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage('正在新增预设…');
    try {
      await sendMutation({
        action: 'CREATE_PRESET',
        label,
        reason,
        scope,
      });
      setLabel('');
      setReason('');
      setMessage('预设标签已新增。');
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '操作失败，请稍后重试。',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="tag-management">
      <form className="tag-create-form" onSubmit={create}>
        <label>
          新预设标签
          <input
            disabled={pending}
            maxLength={32}
            name="label"
            onChange={(event) => setLabel(event.target.value)}
            required
            value={label}
          />
        </label>
        <label>
          治理原因
          <input
            disabled={pending}
            maxLength={1000}
            minLength={5}
            name="reason"
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
        </label>
        <button disabled={pending} type="submit">
          {pending ? '新增中…' : '新增预设'}
        </button>
        <p aria-live="polite" className="tag-form-message">
          {message}
        </p>
      </form>

      <section
        aria-labelledby="managed-tags-heading"
        className="tag-list-section"
      >
        <header>
          <h3 id="managed-tags-heading">当前范围标签</h3>
          <span>{items.length} 个定义</span>
        </header>
        {items.length === 0 ? (
          <div className="empty-state">
            <h2>还没有标签定义</h2>
            <p>新增首个预设标签后会显示在这里。</p>
          </div>
        ) : (
          <div className="tag-management-list">
            {items.map((item) => (
              <div className="tag-management-row" key={item.id}>
                <div className="tag-row-identity">
                  <strong>{item.label}</strong>
                  <span>{item.isPreset ? '预设' : '自定义'}</span>
                </div>
                <TagRowActions item={item} scope={scope} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
