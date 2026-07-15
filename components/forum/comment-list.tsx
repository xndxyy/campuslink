'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

export interface PresentedComment {
  authorName: string;
  body: string;
  canManage: boolean;
  createdAt: string;
  id: string;
}

export function CommentList({
  comments,
  postId,
}: {
  comments: PresentedComment[];
  postId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);

  async function mutate(
    method: 'POST' | 'PATCH' | 'DELETE',
    body: Record<string, string>,
  ) {
    setPending(true);
    setMessage('');
    try {
      const response = await fetch(
        `/api/forum/posts/${encodeURIComponent(postId)}/comments`,
        {
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
          method,
        },
      );
      const result = (await response.json().catch(() => null)) as {
        message?: unknown;
      } | null;
      if (!response.ok)
        throw new Error(
          typeof result?.message === 'string'
            ? result.message
            : '评论操作失败，请稍后重试。',
        );
      setEditing(null);
      setMessage(
        method === 'POST'
          ? '评论已发布。'
          : method === 'PATCH'
            ? '评论已更新。'
            : '评论已删除。',
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '评论操作失败，请稍后重试。',
      );
    } finally {
      setPending(false);
    }
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void mutate('POST', { body: String(data.get('body') ?? '') }).then(() =>
      form.reset(),
    );
  }
  function update(event: FormEvent<HTMLFormElement>, commentId: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void mutate('PATCH', { body: String(data.get('body') ?? ''), commentId });
  }

  return (
    <section className="comment-section">
      <header>
        <h2>评论</h2>
        <span>{comments.length} 条</span>
      </header>
      <form className="comment-form" onSubmit={create}>
        <label htmlFor="new-comment">发表评论</label>
        <textarea
          aria-label="发表评论"
          id="new-comment"
          maxLength={1000}
          minLength={2}
          name="body"
          required
          rows={4}
        />
        <button disabled={pending} type="submit">
          {pending ? '提交中...' : '发表评论'}
        </button>
      </form>
      {comments.length === 0 ? (
        <p className="forum-empty-inline">还没有评论。</p>
      ) : (
        <ol className="comment-list">
          {comments.map((comment) => (
            <li key={comment.id}>
              <div>
                <strong>{comment.authorName}</strong>
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString('zh-CN')}
                </time>
              </div>
              {editing === comment.id ? (
                <form onSubmit={(event) => update(event, comment.id)}>
                  <label
                    className="visually-hidden"
                    htmlFor={`comment-${comment.id}`}
                  >
                    编辑评论
                  </label>
                  <textarea
                    defaultValue={comment.body}
                    id={`comment-${comment.id}`}
                    maxLength={1000}
                    minLength={2}
                    name="body"
                    required
                    rows={3}
                  />
                  <button disabled={pending} type="submit">
                    保存评论
                  </button>
                  <button onClick={() => setEditing(null)} type="button">
                    取消
                  </button>
                </form>
              ) : (
                <p>{comment.body}</p>
              )}
              {comment.canManage && editing !== comment.id ? (
                <div className="comment-actions">
                  <button
                    disabled={pending}
                    onClick={() => setEditing(comment.id)}
                    type="button"
                  >
                    编辑
                  </button>
                  <button
                    disabled={pending}
                    onClick={() =>
                      void mutate('DELETE', { commentId: comment.id })
                    }
                    type="button"
                  >
                    删除
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <p aria-live="polite" className="forum-action-message">
        {message}
      </p>
    </section>
  );
}
