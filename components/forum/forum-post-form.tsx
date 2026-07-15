'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

type Kind = 'DISCUSSION' | 'TREE_HOLE';

export function ForumPostForm({
  categories,
  initialPost,
  kind,
}: {
  categories: Array<{ label: string; slug: string }>;
  initialPost?: { body: string; category: string; id: string; title: string };
  kind: Kind;
}) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const view = kind === 'TREE_HOLE' ? 'tree-hole' : 'discussion';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setMessage('');
    try {
      const endpoint = initialPost
        ? `/api/forum/posts/${encodeURIComponent(initialPost.id)}?view=${view}`
        : '/api/forum/posts';
      const body = {
        body: String(form.get('body') ?? ''),
        category: String(form.get('category') ?? ''),
        title: String(form.get('title') ?? ''),
        ...(!initialPost ? { kind } : {}),
      };
      const response = await fetch(endpoint, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: initialPost ? 'PATCH' : 'POST',
      });
      const result = (await response.json().catch(() => null)) as {
        id?: unknown;
        message?: unknown;
      } | null;
      if (!response.ok)
        throw new Error(
          typeof result?.message === 'string'
            ? result.message
            : '操作失败，请稍后重试。',
        );
      if (initialPost) {
        setMessage('修改已保存。');
        router.refresh();
      } else if (typeof result?.id === 'string') {
        router.push(
          `/forum/${encodeURIComponent(result.id)}?view=${view}&owner=true`,
        );
      } else {
        throw new Error('发布结果无效，请稍后重试。');
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '操作失败，请稍后重试。',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="forum-post-form" onSubmit={submit}>
      <label>
        标题
        <input
          defaultValue={initialPost?.title}
          maxLength={200}
          minLength={3}
          name="title"
          required
        />
      </label>
      <label>
        分类
        <select
          defaultValue={initialPost?.category ?? ''}
          name="category"
          required
        >
          <option disabled value="">
            请选择分类
          </option>
          {categories.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        正文
        <textarea
          defaultValue={initialPost?.body}
          maxLength={5000}
          minLength={10}
          name="body"
          required
          rows={12}
        />
      </label>
      {kind === 'TREE_HOLE' ? (
        <p className="privacy-note">
          发布后仅显示随机树洞编号。其他用户看不到你的真实身份，管理员仅能按治理流程审计。
        </p>
      ) : null}
      <button disabled={pending} type="submit">
        {pending
          ? initialPost
            ? '保存中...'
            : '发布中...'
          : initialPost
            ? '保存修改'
            : kind === 'TREE_HOLE'
              ? '发布树洞'
              : '发布讨论'}
      </button>
      <p aria-live="polite" className="forum-form-message">
        {message}
      </p>
    </form>
  );
}
