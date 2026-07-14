'use client';

import { useId } from 'react';

export interface AvailableTag {
  id: string;
  label: string;
}

export interface ContentTag extends AvailableTag {
  isActive: boolean;
  isPreset: boolean;
}

export interface TagSelection {
  customTags: string[];
  presetTagIds: string[];
}

export function mergeAvailablePresetTags(
  availableTags: AvailableTag[],
  historicalTags: ContentTag[],
) {
  const merged: AvailableTag[] = [];
  const seen = new Set<string>();
  for (const tag of availableTags) {
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    merged.push(tag);
  }
  for (const tag of historicalTags) {
    if (!tag.isActive || !tag.isPreset || seen.has(tag.id)) continue;
    seen.add(tag.id);
    merged.push({ id: tag.id, label: tag.label });
  }
  return merged;
}

export function TagSelector({
  availableTags,
  historicalTags = [],
  onChange,
  value,
}: {
  availableTags: AvailableTag[];
  historicalTags?: ContentTag[];
  onChange: (selection: TagSelection) => void;
  value: TagSelection;
}) {
  const limitHelpId = useId();
  const customValues = [value.customTags[0] ?? '', value.customTags[1] ?? ''];
  const customCount = customValues.filter((tag) => tag.trim()).length;
  const selectedCount = value.presetTagIds.length + customCount;
  const presetOptions = mergeAvailablePresetTags(availableTags, historicalTags);

  function togglePreset(tagId: string) {
    const selected = value.presetTagIds.includes(tagId);
    onChange({
      ...value,
      presetTagIds: selected
        ? value.presetTagIds.filter((id) => id !== tagId)
        : [...value.presetTagIds, tagId],
    });
  }

  function updateCustomTag(index: number, label: string) {
    const next = [...customValues];
    next[index] = label;
    onChange({ ...value, customTags: next });
  }

  const inactiveHistoricalTags = historicalTags.filter((tag) => !tag.isActive);

  return (
    <fieldset className="tag-selector">
      <legend>选择标签</legend>
      <div className="tag-selector-heading">
        <p>预设标签</p>
        <span aria-live="polite">已选择 {selectedCount} / 5</span>
      </div>
      {presetOptions.length > 0 ? (
        <div className="tag-swatches">
          {presetOptions.map((tag) => {
            const checked = value.presetTagIds.includes(tag.id);
            return (
              <label className="tag-swatch" key={tag.id}>
                <input
                  aria-describedby={limitHelpId}
                  checked={checked}
                  disabled={!checked && selectedCount >= 5}
                  onChange={() => togglePreset(tag.id)}
                  type="checkbox"
                />
                <span>{tag.label}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="tag-selector-empty">当前没有可选的预设标签。</p>
      )}
      <p className="tag-selector-help" id={limitHelpId}>
        最多选择 5 个标签；达到上限后，未选择的选项会停用。
      </p>
      <div className="custom-tag-fields">
        <p>其他自定义标签</p>
        {customValues.map((label, index) => (
          <label key={index}>
            自定义标签 {index + 1}
            <input
              aria-describedby={limitHelpId}
              disabled={!label.trim() && selectedCount >= 5}
              maxLength={32}
              onChange={(event) => updateCustomTag(index, event.target.value)}
              placeholder={index === 0 ? '例如：期末复习' : '可选'}
              value={label}
            />
          </label>
        ))}
        <p className="tag-selector-help">最多添加 2 个自定义标签。</p>
      </div>
      {inactiveHistoricalTags.length > 0 ? (
        <div className="historical-tags">
          <p>已停用的历史标签（保存时将移除）</p>
          <ul aria-label="已停用的历史标签">
            {inactiveHistoricalTags.map((tag) => (
              <li key={tag.id}>{tag.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </fieldset>
  );
}
