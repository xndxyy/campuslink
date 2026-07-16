import { describe, expect, it } from 'vitest';

import { toContentValidationError } from '@/lib/validation/content-errors';
import { createResourceSchema } from '@/lib/validation/content';
import { TagValidationError } from '@/lib/validation/tags';

describe('content validation responses', () => {
  it('maps duplicate custom tags to a Chinese field error', () => {
    const result = createResourceSchema.safeParse({
      assetIds: [],
      customTags: ['测试', '测试'],
      presetTagIds: [],
      summary: '',
      title: '课程提示',
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(toContentValidationError(result.error)).toStrictEqual({
      code: 'CONTENT_VALIDATION_FAILED',
      fieldErrors: {
        customTags: ['自定义标签不能重复，请修改第二个标签。'],
      },
      message: '请检查标出的内容后重试。',
    });
  });

  it('maps domain tag failures without exposing internal codes', () => {
    expect(
      toContentValidationError(new TagValidationError('INACTIVE_TAG')),
    ).toStrictEqual({
      code: 'CONTENT_VALIDATION_FAILED',
      fieldErrors: { presetTagIds: ['所选预设标签已停用，请重新选择。'] },
      message: '请检查标出的内容后重试。',
    });
  });
});
