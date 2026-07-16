'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContentRecord } from '@/lib/domain/content-service';
import { TagSelector } from '@/components/content/tag-selector';
import type {
  AvailableTag,
  ContentTag,
  TagSelection,
} from '@/components/content/tag-selector';

function contentTags(item: ContentRecord): ContentTag[] {
  if (!Array.isArray(item.tags)) return [];
  return item.tags.filter((tag): tag is ContentTag => {
    if (!tag || typeof tag !== 'object') return false;
    const candidate = tag as Partial<ContentTag>;
    return (
      typeof candidate.id === 'string' &&
      typeof candidate.label === 'string' &&
      typeof candidate.isActive === 'boolean' &&
      typeof candidate.isPreset === 'boolean'
    );
  });
}

export function EditContentForm({
  item,
  kind,
  availableTags = [],
}: {
  availableTags?: AvailableTag[];
  item: ContentRecord;
  kind: 'resource' | 'marketplace' | 'campus-work';
}) {
  const router = useRouter();
  const historicalTags = contentTags(item);
  const [tagSelection, setTagSelection] = useState<TagSelection>(() => ({
    customTags: historicalTags
      .filter((tag) => tag.isActive && !tag.isPreset)
      .map((tag) => tag.label),
    presetTagIds: historicalTags
      .filter((tag) => tag.isActive && tag.isPreset)
      .map((tag) => tag.id),
  }));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [customTagError, setCustomTagError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage('');
    setCustomTagError('');
    const values: Record<string, unknown> = Object.fromEntries(
      new FormData(form),
    );
    values.presetTagIds = tagSelection.presetTagIds;
    const customTags = tagSelection.customTags
      .map((value) => value.trim())
      .filter(Boolean);
    if (new Set(customTags).size !== customTags.length) {
      const duplicateMessage = '自定义标签不能重复，请修改第二个标签。';
      setMessage(duplicateMessage);
      setCustomTagError(duplicateMessage);
      form
        .querySelector<HTMLInputElement>('[data-custom-tag-index="1"]')
        ?.focus();
      return;
    }
    values.customTags = customTags;
    setPending(true);
    const endpoint =
      kind === 'resource'
        ? 'resources'
        : kind === 'marketplace'
          ? 'marketplace'
          : 'campus-work';
    const response = await fetch(`/api/${endpoint}/${item.id}`, {
      body: JSON.stringify({ action: 'edit', data: values }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    });
    const body = (await response.json().catch(() => null)) as {
      fieldErrors?: Record<string, string[]>;
      message?: string;
    } | null;
    if (!response.ok) {
      setCustomTagError(body?.fieldErrors?.customTags?.[0] ?? '');
      setMessage(body?.message ?? '保存失败，请重试。');
    }
    else {
      setMessage('已保存为草稿。');
      router.push('/me/submissions');
      router.refresh();
    }
    setPending(false);
  }
  return (
    <form className="submission-form" onSubmit={submit}>
      {kind === 'campus-work' ? (
        <label>
          联系方式
          <textarea
            defaultValue={String(item.contact ?? '')}
            name="contact"
            required
          />
        </label>
      ) : null}
      <label>
        标题
        <input defaultValue={String(item.title ?? '')} name="title" required />
      </label>
      <label>
        {kind === 'resource' ? '内容说明（可选）' : '详细说明'}
        <textarea
          defaultValue={String(item.summary ?? item.description ?? '')}
          name={kind === 'resource' ? 'summary' : 'description'}
          required={kind !== 'resource'}
          rows={8}
        />
      </label>
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
              <option value="POOR">明显磨损</option>
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
      <TagSelector
        availableTags={availableTags}
        customError={customTagError}
        historicalTags={historicalTags}
        onChange={(selection) => {
          setCustomTagError('');
          setTagSelection(selection);
        }}
        value={tagSelection}
      />
      {kind === 'campus-work' ? (
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
