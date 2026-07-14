import { describe, expect, it } from 'vitest';

import * as tagSelectorModule from '@/components/content/tag-selector';

describe('tag selector preset options', () => {
  it('merges missing active historical presets by id without exposing inactive or custom tags', () => {
    const merge = Reflect.get(
      tagSelectorModule,
      'mergeAvailablePresetTags',
    ) as unknown;
    expect(merge).toBeTypeOf('function');
    if (typeof merge !== 'function') return;

    expect(
      merge(
        [{ id: 'available_1', label: '第一页标签' }],
        [
          {
            id: 'available_1',
            isActive: true,
            isPreset: true,
            label: '重复历史标签',
          },
          {
            id: 'window_101',
            isActive: true,
            isPreset: true,
            label: '窗口外仍在使用的预设标签',
          },
          {
            id: 'inactive_preset',
            isActive: false,
            isPreset: true,
            label: '已停用预设',
          },
          {
            id: 'active_custom',
            isActive: true,
            isPreset: false,
            label: '已有自定义标签',
          },
        ],
      ),
    ).toEqual([
      { id: 'available_1', label: '第一页标签' },
      { id: 'window_101', label: '窗口外仍在使用的预设标签' },
    ]);
  });
});
