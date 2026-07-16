import Link from 'next/link';
import { ResendVerificationForm } from '@/components/auth/resend-verification-form';

interface VerifyPageProps {
  searchParams: Promise<{ error?: string; sent?: string; token?: string }>;
}

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const { error, sent, token } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-bold text-slate-950">验证邮箱</h1>
        {sent ? (
          <p
            className="mt-4 rounded-md bg-blue-50 p-3 text-sm text-blue-900"
            role="status"
          >
            如果该邮箱正在等待验证，请查看收件箱中的最新验证邮件。
          </p>
        ) : null}
        {error ? (
          <p
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {error === 'rate-limit'
              ? '操作过于频繁，请稍后再试。'
              : error === 'temporary'
                ? '暂时无法发送验证邮件，请稍后重试。'
                : '验证链接无效或已过期。'}
          </p>
        ) : null}
        {token ? (
          <form
            action="/api/auth/verify"
            className="mt-6 space-y-4"
            method="post"
          >
            <input name="token" type="hidden" value={token} />
            <p className="text-sm leading-6 text-slate-600">
              设置密码后即可完成邮箱验证并激活 CampusLink 账号。
            </p>
            <label
              className="block text-sm font-medium text-slate-800"
              htmlFor="password"
            >
              密码
            </label>
            <input
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              id="password"
              minLength={12}
              name="password"
              required
              type="password"
            />
            <label
              className="block text-sm font-medium text-slate-800"
              htmlFor="confirmPassword"
            >
              确认密码
            </label>
            <input
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              id="confirmPassword"
              minLength={12}
              name="confirmPassword"
              required
              type="password"
            />
            <p className="text-xs text-slate-600">
              至少 12 个字符，并同时包含大写字母、小写字母、数字和符号。
            </p>
            <button
              className="mt-4 w-full rounded-md bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
              type="submit"
            >
              完成验证
            </button>
          </form>
        ) : (
          <>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              打开验证邮件中的链接即可继续注册。只有最新一封验证邮件中的链接有效。
            </p>
            <ResendVerificationForm initialSent={Boolean(sent)} />
          </>
        )}
        <p className="mt-6 text-sm text-slate-600">
          <Link
            className="font-semibold text-blue-700 hover:underline"
            href="/auth/sign-in"
          >
            返回登录
          </Link>
        </p>
      </section>
    </main>
  );
}
