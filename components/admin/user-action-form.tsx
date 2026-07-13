'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type UserAction = 'SET_ROLE' | 'SET_STATUS' | 'REVOKE_SESSIONS';

const roleLabels: Record<string, string> = {
  ADMIN: '管理员',
  MODERATOR: '版主',
  STUDENT: '普通用户',
};

export function completeUserAction(
  result: { selfRevoked?: boolean },
  effects: { navigate: (href: string) => void; refresh: () => void },
) {
  if (result.selfRevoked) {
    effects.navigate('/auth/sign-in');
    return;
  }
  effects.refresh();
}

function ActionControl({
  action,
  currentRole,
  label,
  statusTarget,
  userId,
}: {
  action: UserAction;
  currentRole: string;
  label: string;
  statusTarget?: 'ACTIVE' | 'SUSPENDED';
  userId: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const titleId = `manage-user-${action}-${userId}`;
  const reasonId = `${titleId}-reason`;
  const defaultRole =
    currentRole === 'STUDENT'
      ? 'MODERATOR'
      : currentRole === 'MODERATOR'
        ? 'STUDENT'
        : 'MODERATOR';

  function payload(formData: FormData) {
    const reason = String(formData.get('reason') ?? '');
    if (action === 'SET_ROLE') {
      return {
        action: 'SET_ROLE' as const,
        reason,
        role: String(formData.get('role')),
        userId,
      };
    }
    if (action === 'SET_STATUS') {
      return {
        action: 'SET_STATUS' as const,
        reason,
        status: statusTarget,
        userId,
      };
    }
    return { action: 'REVOKE_SESSIONS' as const, reason, userId };
  }

  async function submit(formData: FormData) {
    if (pending) return;
    setPending(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/users', {
        body: JSON.stringify(payload(formData)),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      const result = (await response.json()) as {
        selfRevoked?: boolean;
      };
      if (!response.ok) {
        throw new Error('操作未完成，请检查目标用户状态后重试。');
      }
      setMessage('操作已记录。');
      dialog.current?.close();
      completeUserAction(result, {
        navigate: (href) => window.location.assign(href),
        refresh: () => router.refresh(),
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '操作未完成，请重试。',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="admin-user-action">
      <button
        disabled={pending}
        onClick={() => dialog.current?.showModal()}
        type="button"
      >
        {label}
      </button>
      <dialog aria-labelledby={titleId} ref={dialog}>
        <form action={submit} className="admin-dialog-form">
          <p className="eyebrow">管理员操作</p>
          <h2 id={titleId}>确认执行“{label}”</h2>
          <p id={reasonId}>该操作会写入审计记录，请填写可复核的治理原因。</p>
          {action === 'SET_ROLE' ? (
            <label>
              新角色（当前：{roleLabels[currentRole] ?? currentRole}）
              <select defaultValue={defaultRole} name="role">
                <option value="STUDENT">普通用户</option>
                <option value="MODERATOR">版主</option>
                <option value="ADMIN">管理员</option>
              </select>
            </label>
          ) : null}
          <label>
            操作原因
            <textarea
              aria-describedby={reasonId}
              maxLength={1000}
              minLength={5}
              name="reason"
              required
              rows={4}
            />
          </label>
          <span aria-live="polite" className="admin-action-message">
            {message}
          </span>
          <div className="dialog-actions">
            <button disabled={pending} type="submit">
              {pending ? '正在处理…' : '确认执行'}
            </button>
            <button
              disabled={pending}
              onClick={() => dialog.current?.close()}
              type="button"
            >
              取消
            </button>
          </div>
        </form>
      </dialog>
      <span aria-live="polite" className="admin-action-message">
        {message}
      </span>
    </div>
  );
}

export function UserActionForm({
  currentRole,
  currentStatus,
  emailVerified,
  userId,
}: {
  currentRole: string;
  currentStatus: string;
  emailVerified: boolean;
  userId: string;
}) {
  const isPending = currentStatus === 'PENDING_VERIFICATION';
  const canRestore = currentStatus === 'SUSPENDED' && emailVerified;
  return (
    <div className="admin-user-actions" aria-label="用户治理操作">
      <ActionControl
        action="SET_ROLE"
        currentRole={currentRole}
        label="调整角色"
        userId={userId}
      />
      {currentStatus === 'ACTIVE' ? (
        <ActionControl
          action="SET_STATUS"
          currentRole={currentRole}
          label="停用账号"
          statusTarget="SUSPENDED"
          userId={userId}
        />
      ) : canRestore ? (
        <ActionControl
          action="SET_STATUS"
          currentRole={currentRole}
          label="恢复账号"
          statusTarget="ACTIVE"
          userId={userId}
        />
      ) : (
        <p className="admin-user-status-readonly">
          {isPending
            ? '待验证账号只能由用户完成邮箱验证；管理员不能代为完成邮箱验证。'
            : '该停用账号尚未验证邮箱，当前不可恢复；管理员不能代为完成邮箱验证。'}
        </p>
      )}
      <ActionControl
        action="REVOKE_SESSIONS"
        currentRole={currentRole}
        label="强制退出全部设备"
        userId={userId}
      />
    </div>
  );
}
