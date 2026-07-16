import Link from 'next/link';

interface SignInPageProps {
  searchParams: Promise<{ error?: string; verified?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { error, verified } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-bold text-slate-950">登录 CampusLink</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          使用已验证的邮箱和密码登录。
        </p>
        {verified ? (
          <p
            className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800"
            role="status"
          >
            邮箱验证成功，现在可以登录。
          </p>
        ) : null}
        {error ? (
          <p
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {error === 'rate-limit'
              ? '操作过于频繁，请稍后再试。'
              : '邮箱或密码错误。'}
          </p>
        ) : null}
        <form
          action="/api/auth/sign-in"
          className="mt-6 space-y-4"
          method="post"
        >
          <label
            className="block text-sm font-medium text-slate-800"
            htmlFor="email"
          >
            邮箱
          </label>
          <input
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            id="email"
            name="email"
            required
            type="email"
          />
          <label
            className="block text-sm font-medium text-slate-800"
            htmlFor="password"
          >
            密码
          </label>
          <input
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            id="password"
            name="password"
            required
            type="password"
          />
          <button
            className="w-full rounded-md bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
            type="submit"
          >
            登录
          </button>
        </form>
        <p className="mt-6 text-sm text-slate-600">
          还没有账号？{' '}
          <Link
            className="font-semibold text-blue-700 hover:underline"
            href="/auth/sign-up"
          >
            注册
          </Link>
        </p>
      </section>
    </main>
  );
}
