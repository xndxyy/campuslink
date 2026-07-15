'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import type { ForumView } from './forum-tabs';
import { forumStatusLabel } from './forum-status';

export function ForumActions({
  id,
  initialLikeCount,
  owner,
  status,
  view,
}: {
  id: string;
  initialLikeCount: number;
  owner: boolean;
  status: string;
  view: ForumView;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<'delete' | 'like' | 'report' | null>(
    null,
  );
  const [reportOpen, setReportOpen] = useState(false);
  const interactive = status === 'PUBLISHED';

  async function toggleLike() {
    setPending('like');
    setMessage('');
    try {
      const response = await fetch(
        `/api/forum/posts/${encodeURIComponent(id)}/likes`,
        {
          body: '{}',
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      );
      const result = (await response.json().catch(() => null)) as {
        liked?: unknown;
        likeCount?: unknown;
        message?: unknown;
      } | null;
      if (
        !response.ok ||
        typeof result?.liked !== 'boolean' ||
        typeof result.likeCount !== 'number'
      )
        throw new Error(
          typeof result?.message === 'string'
            ? result.message
            : '点赞失败，请稍后重试。',
        );
      setLiked(result.liked);
      setLikeCount(result.likeCount);
      setMessage(result.liked ? '已点赞。' : '已取消点赞。');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '点赞失败，请稍后重试。',
      );
    } finally {
      setPending(null);
    }
  }

  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending('report');
    setMessage('');
    try {
      const response = await fetch('/api/reports', {
        body: JSON.stringify({
          details: String(form.get('details') ?? '').trim() || undefined,
          reason: String(form.get('reason') ?? ''),
          targetId: id,
          targetType: 'FORUM_POST',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) throw new Error('举报提交失败，请稍后重试。');
      formElement.reset();
      setReportOpen(false);
      setMessage('举报已提交。');
    } catch {
      setMessage('举报提交失败，请稍后重试。');
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (!window.confirm('确认删除这篇帖子吗？有未处理举报时帖子将改为归档。'))
      return;
    setPending('delete');
    setMessage('');
    try {
      const response = await fetch(
        `/api/forum/posts/${encodeURIComponent(id)}?view=${view}`,
        {
          body: '{}',
          headers: { 'Content-Type': 'application/json' },
          method: 'DELETE',
        },
      );
      const result = (await response.json().catch(() => null)) as {
        archived?: unknown;
        deleted?: unknown;
        message?: unknown;
      } | null;
      if (!response.ok)
        throw new Error(
          typeof result?.message === 'string'
            ? result.message
            : '删除失败，请稍后重试。',
        );
      if (result?.archived === true) {
        setMessage('帖子存在处理中举报，已转为归档并停止互动。');
        router.refresh();
      } else {
        router.push(`/forum?view=${view}`);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '删除失败，请稍后重试。',
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-label="帖子操作" className="forum-actions">
      {!interactive ? (
        <p className="forum-status-note">
          当前状态：{forumStatusLabel(status)}。此帖子不再开放互动。
        </p>
      ) : (
        <div className="forum-action-buttons">
          <button
            aria-pressed={liked}
            disabled={pending !== null}
            onClick={() => void toggleLike()}
            type="button"
          >
            {pending === 'like'
              ? '保存中...'
              : liked
                ? `取消点赞 ${likeCount}`
                : `点赞 ${likeCount}`}
          </button>
          <button
            disabled={pending !== null}
            onClick={() => setReportOpen(true)}
            type="button"
          >
            举报
          </button>
        </div>
      )}
      {owner ? (
        <button
          className="danger-button"
          disabled={pending !== null}
          onClick={() => void remove()}
          type="button"
        >
          {pending === 'delete' ? '删除中...' : '删除帖子'}
        </button>
      ) : null}
      {reportOpen ? (
        <div
          aria-labelledby="forum-report-title"
          aria-modal="true"
          className="forum-report-dialog"
          role="dialog"
        >
          <form onSubmit={report}>
            <h2 id="forum-report-title">举报帖子</h2>
            <label>
              举报原因
              <select defaultValue="" name="reason" required>
                <option disabled value="">
                  请选择原因
                </option>
                <option value="SPAM">垃圾信息</option>
                <option value="MISLEADING">虚假或误导信息</option>
                <option value="HARASSMENT">骚扰行为</option>
                <option value="PROHIBITED">违规内容</option>
                <option value="OTHER">其他</option>
              </select>
            </label>
            <label>
              补充说明（可选）
              <textarea maxLength={1000} name="details" rows={4} />
            </label>
            <div>
              <button disabled={pending === 'report'} type="submit">
                {pending === 'report' ? '提交中...' : '提交举报'}
              </button>
              <button onClick={() => setReportOpen(false)} type="button">
                取消
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <p aria-live="polite" className="forum-action-message">
        {message}
      </p>
    </section>
  );
}
