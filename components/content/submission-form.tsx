'use client';

import { useState } from 'react';

import { FileUploader } from '@/components/uploads/file-uploader';
import { TagSelector } from '@/components/content/tag-selector';
import {
  contentMutationErrorMessage,
  contentMutationSuccessMessage,
} from '@/lib/client/content-feedback';
import type {
  AvailableTag,
  TagSelection,
} from '@/components/content/tag-selector';

type FormKind = 'resource' | 'marketplace' | 'campus-work';

const emptyTagSelection = (): TagSelection => ({
  customTags: ['', ''],
  presetTagIds: [],
});

export function SubmissionForm({
  availableTags = [],
  kind,
}: {
  availableTags?: AvailableTag[];
  kind: FormKind;
}) {
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [tagSelection, setTagSelection] =
    useState<TagSelection>(emptyTagSelection);
  const [state, setState] = useState<'idle' | 'pending' | 'success' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');
  const [customTagError, setCustomTagError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage('');
    setCustomTagError('');
    const values = Object.fromEntries(new FormData(form));
    const body: Record<string, unknown> = { ...values };
    if (kind === 'resource' || kind === 'marketplace') body.assetIds = assetIds;
    body.presetTagIds = tagSelection.presetTagIds;
    const customTags = tagSelection.customTags
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (new Set(customTags).size !== customTags.length) {
      const duplicateMessage = '自定义标签不能重复，请修改第二个标签。';
      setState('error');
      setMessage(duplicateMessage);
      setCustomTagError(duplicateMessage);
      form
        .querySelector<HTMLInputElement>('[data-custom-tag-index="1"]')
        ?.focus();
      return;
    }
    body.customTags = customTags;
    setState('pending');
    const endpoint =
      kind === 'resource'
        ? 'resources'
        : kind === 'marketplace'
          ? 'marketplace'
          : 'campus-work';
    try {
      const response = await fetch(`/api/${endpoint}`, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const result = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!response.ok)
        if (
          result?.fieldErrors &&
          typeof result.fieldErrors === 'object' &&
          Array.isArray(
            (result.fieldErrors as Record<string, unknown>).customTags,
          )
        ) {
          const [firstError] = (result.fieldErrors as Record<string, unknown[]>)
            .customTags;
          if (typeof firstError === 'string') setCustomTagError(firstError);
        }
      if (!response.ok)
        throw new Error(
          contentMutationErrorMessage(result, '提交失败，请稍后重试。'),
        );
      setState('success');
      setMessage(contentMutationSuccessMessage(result));
      form.reset();
      setAssetIds([]);
      setTagSelection(emptyTagSelection());
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
      <label>
        标题
        <input name="title" required minLength={3} maxLength={200} />
      </label>
      <label>
        {kind === 'resource' ? '内容说明（可选）' : '详细说明'}
        <textarea
          name={kind === 'resource' ? 'summary' : 'description'}
          required={kind !== 'resource'}
          minLength={kind === 'resource' ? undefined : 20}
          maxLength={5000}
          rows={8}
        />
      </label>
      {kind === 'resource' ? (
        <>
          <FileUploader kind="RESOURCE_DOCUMENT" onReady={rememberAsset} />
          <FileUploader kind="RESOURCE_IMAGE" onReady={rememberAsset} />
        </>
      ) : null}
      <TagSelector
        availableTags={availableTags}
        customError={customTagError}
        onChange={(selection) => {
          setCustomTagError('');
          setTagSelection(selection);
        }}
        value={tagSelection}
      />
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
      {kind === 'campus-work' ? (
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
      {kind === 'campus-work' ? (
        <label>
          联系方式（仅向符合条件的已验证同校用户揭示）
          <textarea
            name="contact"
            required
            minLength={3}
            maxLength={300}
            rows={3}
          />
        </label>
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
