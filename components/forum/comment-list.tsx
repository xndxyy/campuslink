'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import {
  commentPageAfterDelete,
  commentPageHref,
  lastCommentPage,
} from './comment-pagination';
import { parseForumCommentDeleteResult } from './forum-action-result';
import type { ForumView } from './forum-tabs';
import {
  contentMutationErrorMessage,
  contentMutationSuccessMessage,
} from '@/lib/client/content-feedback';

export interface PresentedComment {
  authorName: string;
  body: string;
  canManage: boolean;
  createdAt: string;
  id: string;
}

export function CommentList({
  comments,
  error,
  owner,
  page,
  pageSize,
  postId,
  total,
  view,
}: {
  comments: PresentedComment[];
  error?: string;
  owner: boolean;
  page: number;
  pageSize: number;
  postId: string;
  total: number;
  view: ForumView;
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
      const result = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!response.ok)
        throw new Error(
          contentMutationErrorMessage(result, '评论操作失败，请稍后重试。'),
        );
      if (method !== 'DELETE') {
        setEditing(null);
        setMessage(contentMutationSuccessMessage(result));
      }
      return { body: result, ok: true as const };
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '评论操作失败，请稍后重试。',
      );
      return { ok: false as const };
    } finally {
      setPending(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const outcome = await mutate('POST', {
      body: String(data.get('body') ?? ''),
    });
    if (outcome.ok) {
      form.reset();
      const destination = lastCommentPage(total + 1, pageSize);
      router.push(commentPageHref({ owner, page: destination, postId, view }));
      router.refresh();
    }
  }
  async function update(event: FormEvent<HTMLFormElement>, commentId: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (
      (
        await mutate('PATCH', {
          body: String(data.get('body') ?? ''),
          commentId,
        })
      ).ok
    ) {
      router.refresh();
    }
  }

  async function removeComment(commentId: string) {
    const mutation = await mutate('DELETE', { commentId });
    if (!mutation.ok) return;
    try {
      const outcome = parseForumCommentDeleteResult(mutation.body);
      setMessage(outcome.message);
      const destination = commentPageAfterDelete({ page, pageSize, total });
      if (destination < page) {
        router.push(
          commentPageHref({ owner, page: destination, postId, view }),
        );
      } else {
        router.refresh();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : '评论删除结果无效，请稍后重试。',
      );
    }
  }

  const pageCount = lastCommentPage(total, pageSize);

  if (error) {
    return (
      <section className="comment-section">
        <header>
          <h2>评论</h2>
        </header>
        <p className="notice error-state" role="alert">
          {error}
        </p>
      </section>
    );
  }

  return (
    <section className="comment-section">
      <header>
        <h2>评论</h2>
        <span>{total} 条</span>
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
                <form onSubmit={(event) => void update(event, comment.id)}>
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
                    onClick={() => void removeComment(comment.id)}
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
      <nav aria-label="评论分页" className="pagination comment-pagination">
        {page > 1 ? (
          <Link
            href={commentPageHref({
              owner,
              page: page - 1,
              postId,
              view,
            })}
          >
            上一页
          </Link>
        ) : (
          <span />
        )}
        <span>
          第 {page} / {pageCount} 页
        </span>
        {page < pageCount ? (
          <Link
            href={commentPageHref({
              owner,
              page: page + 1,
              postId,
              view,
            })}
          >
            下一页
          </Link>
        ) : null}
      </nav>
      <p aria-live="polite" className="forum-action-message">
        {message}
      </p>
    </section>
  );
}
