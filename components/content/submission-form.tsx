'use client';

import { useState } from 'react';

import { FileUploader } from '@/components/uploads/file-uploader';

type FormKind = 'resource' | 'marketplace' | 'job';

export function SubmissionForm({ kind }: { kind: FormKind }) {
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [state, setState] = useState<'idle' | 'pending' | 'success' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setState('pending');
    setMessage('');
    const values = Object.fromEntries(new FormData(form));
    const body: Record<string, unknown> = { ...values };
    if (kind !== 'job') body.assetIds = assetIds;
    if (kind === 'resource') {
      body.tags = String(values.tags ?? '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    const endpoint =
      kind === 'resource'
        ? 'resources'
        : kind === 'marketplace'
          ? 'marketplace'
          : 'jobs';
    try {
      const response = await fetch(`/api/${endpoint}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const result = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!response.ok)
        throw new Error(result?.message ?? '提交失败，请稍后重试。');
      setState('success');
      setMessage('已进入审核队列。你可以在“我的提交”查看状态。');
      form.reset();
      setAssetIds([]);
    } catch (error) {
      setState('error');
      setMessage(
        error instanceof Error ? error.message : '提交失败，请稍后重试。',
      );
    }
  }

  const rememberAsset = (assetId: string) =>
    setAssetIds((current) =>
      current.includes(assetId) ? current : [...current, assetId],
    );

  return (
    <form className="submission-form" onSubmit={submit}>
      {kind === 'job' ? (
        <label>
          发布单位
          <input name="company" required minLength={2} maxLength={200} />
        </label>
      ) : null}
      <label>
        标题
        <input name="title" required minLength={3} maxLength={200} />
      </label>
      <label>
        {kind === 'resource' ? '内容摘要' : '详细说明'}
        <textarea
          name={kind === 'resource' ? 'summary' : 'description'}
          required
          minLength={20}
          maxLength={5000}
          rows={8}
        />
      </label>
      {kind === 'resource' ? (
        <>
          <label>
            课程代码（可选）
            <input name="courseCode" maxLength={64} />
          </label>
          <label>
            标签（用英文逗号分隔）
            <input name="tags" maxLength={200} />
          </label>
          <FileUploader kind="RESOURCE_DOCUMENT" onReady={rememberAsset} />
          <FileUploader kind="RESOURCE_IMAGE" onReady={rememberAsset} />
        </>
      ) : null}
      {kind === 'marketplace' ? (
        <>
          <div className="form-grid">
            <label>
              价格（元）
              <input
                name="price"
                inputMode="decimal"
                placeholder="19.99"
                required
              />
            </label>
            <label>
              物品状态
              <select name="condition" defaultValue="GOOD">
                <option value="NEW">全新</option>
                <option value="LIKE_NEW">近乎全新</option>
                <option value="GOOD">状态良好</option>
                <option value="FAIR">有使用痕迹</option>
                <option value="POOR">明显磨损</option>
              </select>
            </label>
          </div>
          <label>
            取货区域
            <input name="pickupArea" required minLength={2} maxLength={200} />
          </label>
          <label>
            联系方式说明（公开详情不会展示）
            <textarea
              name="contact"
              required
              minLength={3}
              maxLength={300}
              rows={3}
            />
          </label>
          <FileUploader kind="MARKETPLACE_IMAGE" onReady={rememberAsset} />
        </>
      ) : null}
      {kind === 'job' ? (
        <div className="form-grid">
          <label>
            地点
            <input name="location" required minLength={2} maxLength={200} />
          </label>
          <label>
            薪酬说明
            <input name="payText" required minLength={2} maxLength={200} />
          </label>
        </div>
      ) : null}
      <div className="form-footer">
        <button disabled={state === 'pending'} type="submit">
          {state === 'pending' ? '正在提交…' : '提交审核'}
        </button>
        <p
          aria-live="polite"
          className={state === 'error' ? 'form-error' : 'form-message'}
        >
          {message}
        </p>
      </div>
    </form>
  );
}
