'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContentRecord } from '@/lib/domain/content-service';

export function EditContentForm({
  item,
  kind,
}: {
  item: ContentRecord;
  kind: 'resource' | 'marketplace' | 'job';
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage('');
    const values: Record<string, unknown> = Object.fromEntries(
      new FormData(event.currentTarget),
    );
    if (kind === 'resource')
      values.tags = String(values.tags ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const endpoint =
      kind === 'resource'
        ? 'resources'
        : kind === 'marketplace'
          ? 'marketplace'
          : 'jobs';
    const response = await fetch(`/api/${endpoint}/${item.id}`, {
      body: JSON.stringify({ action: 'edit', data: values }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    });
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    if (!response.ok) setMessage(body?.message ?? '保存失败，请重试。');
    else {
      setMessage('已保存为草稿。');
      router.push('/me/submissions');
      router.refresh();
    }
    setPending(false);
  }
  return (
    <form className="submission-form" onSubmit={submit}>
      {kind === 'job' ? (
        <label>
          发布单位
          <input
            defaultValue={String(item.company ?? '')}
            name="company"
            required
          />
        </label>
      ) : null}
      <label>
        标题
        <input defaultValue={String(item.title ?? '')} name="title" required />
      </label>
      <label>
        {kind === 'resource' ? '内容摘要' : '详细说明'}
        <textarea
          defaultValue={String(item.summary ?? item.description ?? '')}
          name={kind === 'resource' ? 'summary' : 'description'}
          required
          rows={8}
        />
      </label>
      {kind === 'resource' ? (
        <>
          <label>
            课程代码
            <input
              defaultValue={String(item.courseCode ?? '')}
              name="courseCode"
            />
          </label>
          <label>
            标签
            <input
              defaultValue={
                Array.isArray(item.tags) ? item.tags.join(', ') : ''
              }
              name="tags"
            />
          </label>
        </>
      ) : null}
      {kind === 'marketplace' ? (
        <>
          <label>
            价格（元）
            <input
              defaultValue={(Number(item.priceCents) / 100).toFixed(2)}
              name="price"
              required
            />
          </label>
          <label>
            状态
            <select defaultValue={String(item.condition)} name="condition">
              <option value="NEW">全新</option>
              <option value="LIKE_NEW">近乎全新</option>
              <option value="GOOD">良好</option>
              <option value="FAIR">有使用痕迹</option>
            </select>
          </label>
          <label>
            取货区域
            <input
              defaultValue={String(item.pickupArea)}
              name="pickupArea"
              required
            />
          </label>
          <label>
            联系方式说明
            <textarea
              defaultValue={String(item.contact)}
              name="contact"
              required
            />
          </label>
        </>
      ) : null}
      {kind === 'job' ? (
        <>
          <label>
            地点
            <input
              defaultValue={String(item.location)}
              name="location"
              required
            />
          </label>
          <label>
            薪酬说明
            <input
              defaultValue={String(item.payText)}
              name="payText"
              required
            />
          </label>
        </>
      ) : null}
      <div className="form-footer">
        <button disabled={pending} type="submit">
          {pending ? '保存中…' : '保存草稿'}
        </button>
        <p aria-live="polite">{message}</p>
      </div>
    </form>
  );
}
