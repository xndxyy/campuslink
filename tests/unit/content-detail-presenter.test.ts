import { describe, expect, it } from 'vitest';
import { documentAccessLink } from '@/components/content/public-detail';
import { contentTagsForPresentation } from '@/lib/domain/public-content';

describe('document detail presentation', () => {
  it('shows sign-in instead of a working document URL to anonymous visitors', () => {
    expect(documentAccessLink('asset_1', false)).toEqual({
      href: '/auth/sign-in',
      label: '登录后下载文档',
    });
    expect(documentAccessLink('asset_1', true)).toEqual({
      href: '/api/assets/asset_1/read',
      label: '下载文档',
    });
  });
});

describe('content tag presentation', () => {
  it('keeps inactive historical tags visible', () => {
    expect(
      contentTagsForPresentation({
        id: 'resource_1',
        tags: [
          {
            id: 'inactive_1',
            isActive: false,
            isPreset: true,
            label: '历史标签',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'inactive_1',
        isActive: false,
        isPreset: true,
        label: '历史标签',
      },
    ]);
  });
});
