'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import {
  FileUploader,
  type UploadPhase,
} from '@/components/uploads/file-uploader';

export function AnnouncementForm() {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [title, setTitle] = useState('');
  const [uploadActive, setUploadActive] = useState(false);
  const [uploaderKey, setUploaderKey] = useState(0);
  const coverReady = useCallback((assetId: string) => {
    setCoverAssetId(assetId);
    setMessage('封面上传完成，可以发布。');
  }, []);
  const coverSelectionStart = useCallback(() => {
    setCoverAssetId(null);
    setMessage('正在上传新封面，完成后才能发布。');
  }, []);
  const coverStateChange = useCallback((phase: UploadPhase) => {
    if (phase === 'cancelled') {
      setMessage('封面上传已取消；可以重试，或不带封面发布。');
    }
    if (phase === 'error') {
      setMessage('封面上传失败；可以重试，或不带封面发布。');
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || uploadActive) {
      setMessage('请等待封面上传完成后再发布公告。');
      return;
    }
    setPending(true);
    setMessage('正在发布公告…');
    try {
      const response = await fetch('/api/admin/announcements', {
        body: JSON.stringify({ body, coverAssetId, isPinned, title }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error('发布失败，请稍后重试。');
      setBody('');
      setCoverAssetId(null);
      setIsPinned(false);
      setTitle('');
      setUploaderKey((value) => value + 1);
      setMessage('公告已发布。');
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '发布失败，请稍后重试。',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="announcement-form" onSubmit={submit}>
      <label>
        公告标题
        <input
          disabled={pending}
          maxLength={200}
          minLength={3}
          name="title"
          onChange={(event) => setTitle(event.target.value)}
          required
          value={title}
        />
      </label>
      <label>
        公告正文
        <textarea
          disabled={pending}
          maxLength={10_000}
          name="body"
          onChange={(event) => setBody(event.target.value)}
          required
          rows={8}
          value={body}
        />
      </label>
      <FileUploader
        key={uploaderKey}
        kind="ANNOUNCEMENT_IMAGE"
        onActiveChange={setUploadActive}
        onReady={coverReady}
        onSelectionStart={coverSelectionStart}
        onStateChange={coverStateChange}
      />
      <label className="checkbox-label">
        <input
          checked={isPinned}
          disabled={pending}
          name="isPinned"
          onChange={(event) => setIsPinned(event.target.checked)}
          type="checkbox"
        />
        置顶此公告
      </label>
      <div className="form-footer">
        <button disabled={pending || uploadActive} type="submit">
          {pending ? '正在发布…' : uploadActive ? '等待封面上传…' : '发布公告'}
        </button>
        <p aria-live="polite" className="form-message">
          {message}
        </p>
      </div>
    </form>
  );
}
