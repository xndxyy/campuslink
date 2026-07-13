'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AnnouncementActionsProps {
  announcementId: string;
  title: string;
}

export function AnnouncementActions({
  announcementId,
  title,
}: AnnouncementActionsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    setMessage('正在永久删除…');
    try {
      const response = await fetch('/api/admin/announcements', {
        body: JSON.stringify({ id: announcementId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('删除失败，请稍后重试。');
      dialogRef.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '删除失败，请稍后重试。',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="announcement-actions">
      <button
        disabled={pending}
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        永久删除
      </button>
      <dialog aria-labelledby={`delete-${announcementId}`} ref={dialogRef}>
        <div className="announcement-delete-dialog">
          <p className="eyebrow">高风险操作</p>
          <h2 id={`delete-${announcementId}`}>永久删除“{title}”</h2>
          <p>
            公告正文、封面和数据库记录都会永久删除，<strong>不可恢复</strong>。
          </p>
          <p aria-live="polite" className="admin-action-message">
            {message}
          </p>
          <div className="dialog-actions">
            <button
              disabled={pending}
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              取消
            </button>
            <button
              disabled={pending}
              onClick={() => void remove()}
              type="button"
            >
              {pending ? '正在删除…' : '确认永久删除'}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
