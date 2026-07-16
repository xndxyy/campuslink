'use client';

import { useEffect, useState } from 'react';

export function ResendVerificationForm({
  initialSent,
}: {
  initialSent: boolean;
}) {
  const [secondsRemaining, setSecondsRemaining] = useState(
    initialSent ? 60 : 0,
  );

  useEffect(() => {
    if (secondsRemaining <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsRemaining((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [secondsRemaining]);

  return (
    <form
      action="/api/auth/resend-verification"
      className="mt-6 space-y-3"
      method="post"
    >
      <label
        className="block text-sm font-medium text-slate-800"
        htmlFor="email"
      >
        需要新的链接？请输入邮箱地址
      </label>
      <input
        autoComplete="email"
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        disabled={secondsRemaining > 0}
        id="email"
        name="email"
        required
        type="email"
      />
      <button
        className="w-full rounded-md border border-blue-700 px-4 py-2 font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={secondsRemaining > 0}
        type="submit"
      >
        {secondsRemaining > 0
          ? `${secondsRemaining} 秒后可重新发送`
          : '重新发送验证邮件'}
      </button>
    </form>
  );
}
