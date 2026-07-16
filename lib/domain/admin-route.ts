import { NextResponse } from 'next/server';

import {
  AuthenticationRequiredError,
  InsufficientPermissionsError,
  VerificationRequiredError,
} from '@/lib/auth/guards';
import {
  AdminConflictError,
  AdminForbiddenError,
  AdminValidationError,
} from './administration';
import {
  AnnouncementConflictError,
  AnnouncementForbiddenError,
  AnnouncementNotFoundError,
  AnnouncementValidationError,
} from './announcements';
import {
  ModerationConflictError,
  ModerationForbiddenError,
  ModerationValidationError,
} from './moderation';
import { TagConflictError, TagForbiddenError } from './tags';
import {
  TreeHoleIdentityForbiddenError,
  TreeHoleIdentityValidationError,
} from './tree-hole-identity';
import {
  BlockedWordConflictError,
  BlockedWordForbiddenError,
  BlockedWordValidationError,
} from './blocked-words';
import {
  AiSettingsConflictError,
  AiSettingsForbiddenError,
  AiSettingsValidationError,
} from './ai-settings';
import { TagValidationError } from '../validation/tags';

const noStoreHeaders = { 'cache-control': 'no-store' };

export function adminJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...noStoreHeaders, ...init?.headers },
  });
}

export function adminErrorResponse(error: unknown) {
  if (error instanceof AuthenticationRequiredError) {
    return adminJson(
      { message: '请先登录。' },
      { status: 401 },
    );
  }
  if (
    error instanceof VerificationRequiredError ||
    error instanceof InsufficientPermissionsError ||
    error instanceof AnnouncementForbiddenError ||
    error instanceof ModerationForbiddenError ||
    error instanceof AdminForbiddenError ||
    error instanceof TagForbiddenError ||
    error instanceof BlockedWordForbiddenError ||
    error instanceof AiSettingsForbiddenError ||
    error instanceof TreeHoleIdentityForbiddenError
  ) {
    return adminJson({ message: '权限不足。' }, { status: 403 });
  }
  if (
    error instanceof ModerationValidationError ||
    error instanceof AnnouncementValidationError ||
    error instanceof AdminValidationError ||
    error instanceof TagValidationError ||
    error instanceof BlockedWordValidationError ||
    error instanceof AiSettingsValidationError ||
    error instanceof TreeHoleIdentityValidationError
  ) {
    return adminJson(
      { message: '管理请求无效。' },
      { status: 400 },
    );
  }
  if (error instanceof ModerationConflictError) {
    return adminJson(
      { message: '审核状态已变化，请刷新后重试。' },
      { status: 409 },
    );
  }
  if (error instanceof AnnouncementConflictError) {
    return adminJson(
      { message: '公告状态已变化，请刷新后重试。' },
      { status: 409 },
    );
  }
  if (error instanceof AnnouncementNotFoundError) {
    return adminJson(
      { message: '未找到该公告。' },
      { status: 404 },
    );
  }
  if (error instanceof AdminConflictError) {
    return adminJson(
      { message: '管理状态已变化，请刷新后重试。' },
      { status: 409 },
    );
  }
  if (error instanceof TagConflictError) {
    return adminJson({ message: '标签状态已变化，请刷新后重试。' }, { status: 409 });
  }
  if (error instanceof BlockedWordConflictError) {
    return adminJson(
      { message: '屏蔽词状态已变化，请刷新后重试。' },
      { status: 409 },
    );
  }
  if (error instanceof AiSettingsConflictError) {
    return adminJson(
      { message: 'AI 服务配置暂时不可用。' },
      { status: 409 },
    );
  }
  return adminJson(
    { message: '暂时无法完成管理操作，请稍后重试。' },
    { status: 500 },
  );
}
