import { sanitizeAuditDetails } from '@/lib/domain/audit-details';

const roleLabels: Record<string, string> = {
  ADMIN: '管理员',
  MODERATOR: '版主',
  STUDENT: '普通用户',
};

const accountStatusLabels: Record<string, string> = {
  ACTIVE: '正常',
  PENDING_VERIFICATION: '待验证',
  SUSPENDED: '已停用',
};

const contentStatusLabels: Record<string, string> = {
  ARCHIVED: '已归档',
  DRAFT: '草稿',
  HIDDEN: '已隐藏',
  PENDING: '待审核',
  PUBLISHED: '已发布',
  REJECTED: '未通过',
};

const reportTargetTypeLabels: Record<string, string> = {
  ASSET: '文件资源',
  JOB_POST: '校园工作',
  MARKETPLACE_ITEM: '二手物品',
  RESOURCE: '学习资源',
  USER: '用户账号',
};

const reportReasonLabels: Record<string, string> = {
  HARASSMENT: '骚扰行为',
  MISLEADING: '误导信息',
  OTHER: '其他原因',
  PROHIBITED: '违规内容',
  SPAM: '垃圾信息',
};

const reportStatusLabels: Record<string, string> = {
  DISMISSED: '已驳回',
  OPEN: '待处理',
  RESOLVED: '已解决',
  TRIAGED: '处理中',
};

const auditDetailKeyLabels: Record<string, string> = {
  from: '变更前',
  name: '名称',
  reason: '原因',
  revokedCount: '撤销会话数',
  role: '角色',
  status: '状态',
  to: '变更后',
};

export function roleLabel(value: string) {
  return roleLabels[value] ?? '其他角色';
}

export function accountStatusLabel(value: string) {
  return accountStatusLabels[value] ?? '其他账号状态';
}

export function contentStatusLabel(value: string) {
  return contentStatusLabels[value] ?? '其他内容状态';
}

export function reportTargetTypeLabel(value: string) {
  return reportTargetTypeLabels[value] ?? '其他举报对象';
}

export function reportReasonLabel(value: string) {
  return reportReasonLabels[value] ?? '其他原因';
}

export function reportStatusLabel(value: string) {
  return reportStatusLabels[value] ?? '其他处理状态';
}

export function auditActionLabel(value: string) {
  const labels: Record<string, string> = {
    USER_ROLE_CHANGED: '调整用户角色',
    USER_SESSIONS_REVOKED: '强制退出全部设备',
    USER_STATUS_CHANGED: '变更账号状态',
  };
  return labels[value] ?? '其他治理事件';
}

function governanceValueLabel(value: string) {
  return (
    roleLabels[value] ??
    accountStatusLabels[value] ??
    contentStatusLabels[value] ??
    reportTargetTypeLabels[value] ??
    reportReasonLabels[value] ??
    reportStatusLabels[value] ??
    value
  );
}

function readableValue(value: unknown): string {
  if (value === null || value === undefined) return '无';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'string') return governanceValueLabel(value);
  if (Array.isArray(value)) return value.map(readableValue).join('、');
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(
        ([key, nested]) =>
          `${auditDetailKeyLabels[key] ?? '其他信息'}：${readableValue(nested)}`,
      )
      .join('；');
  }
  return '其他信息';
}

export function auditDetailRows(value: unknown) {
  const sanitized = sanitizeAuditDetails(value);
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== 'object') {
    return [];
  }
  return Object.entries(sanitized as Record<string, unknown>).map(
    ([key, nested]) => ({
      label: auditDetailKeyLabels[key] ?? '其他信息',
      value: readableValue(nested),
    }),
  );
}
