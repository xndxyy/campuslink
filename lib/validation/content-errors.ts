import { z } from 'zod';

import { TagValidationError } from './tags';

export type ContentValidationResponse = {
  code: 'CONTENT_VALIDATION_FAILED';
  fieldErrors: Record<string, string[]>;
  message: '请检查标出的内容后重试。';
};

const tagMessages: Record<string, { field: string; message: string }> = {
  DUPLICATE_CUSTOM: {
    field: 'customTags',
    message: '自定义标签不能重复，请修改第二个标签。',
  },
  DUPLICATE_PRESET: {
    field: 'presetTagIds',
    message: '预设标签不能重复。',
  },
  INACTIVE_TAG: {
    field: 'presetTagIds',
    message: '所选预设标签已停用，请重新选择。',
  },
  INVALID_LABEL: {
    field: 'customTags',
    message: '自定义标签格式不正确。',
  },
  TAG_COLLISION: {
    field: 'customTags',
    message: '自定义标签含义重复，请修改后重试。',
  },
  TOO_MANY_CUSTOM: {
    field: 'customTags',
    message: '最多添加 2 个自定义标签。',
  },
  TOO_MANY_TAGS: {
    field: 'presetTagIds',
    message: '预设标签和自定义标签合计最多 5 个。',
  },
};

function response(field: string, message: string): ContentValidationResponse {
  return {
    code: 'CONTENT_VALIDATION_FAILED',
    fieldErrors: { [field]: [message] },
    message: '请检查标出的内容后重试。',
  };
}

function zodMessage(issue: z.core.$ZodIssue) {
  const field = String(issue.path?.[0] ?? 'form');
  if (issue.code === 'unrecognized_keys') {
    return { field: 'form', message: '提交内容包含不支持的字段。' };
  }
  if (field === 'customTags') {
    if (/unique|distinct/i.test(issue.message)) {
      return {
        field,
        message: '自定义标签不能重复，请修改第二个标签。',
      };
    }
    return { field, message: '自定义标签格式不正确。' };
  }
  if (field === 'presetTagIds') {
    return { field, message: '预设标签选择无效。' };
  }
  if (field === 'assetIds') {
    return { field, message: '附件数量或状态不正确。' };
  }
  if (field === 'title') {
    return { field, message: '标题长度应为 3 到 200 个字符。' };
  }
  if (field === 'summary') {
    return { field, message: '内容说明不能超过 5000 个字符。' };
  }
  return { field, message: '内容格式不正确。' };
}

export function toContentValidationError(
  error: z.ZodError | TagValidationError,
): ContentValidationResponse {
  if (error instanceof TagValidationError) {
    const mapped = tagMessages[error.code] ?? {
      field: 'presetTagIds',
      message: '标签选择无效，请重新选择。',
    };
    return response(mapped.field, mapped.message);
  }

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const mapped = zodMessage(issue);
    const messages = fieldErrors[mapped.field] ?? [];
    if (!messages.includes(mapped.message)) messages.push(mapped.message);
    fieldErrors[mapped.field] = messages;
  }
  return {
    code: 'CONTENT_VALIDATION_FAILED',
    fieldErrors,
    message: '请检查标出的内容后重试。',
  };
}
