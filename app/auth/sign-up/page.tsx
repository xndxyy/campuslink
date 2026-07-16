import Link from 'next/link';

interface SignUpPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-bold text-slate-950">注册 CampusLink</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          填写任意有效邮箱。我们会先发送验证链接，验证后再设置密码并激活账号。
        </p>
        {error ? (
          <p
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {error === 'rate-limit'
              ? '操作过于频繁，请稍后再试。'
              : error === 'temporary'
                ? '暂时无法发送验证邮件，请稍后重试。'
                : '请检查注册信息后重试。'}
          </p>
        ) : null}
        <form
          action="/api/auth/sign-up"
          className="mt-6 space-y-4"
          method="post"
        >
          <label
            className="block text-sm font-medium text-slate-800"
            htmlFor="name"
          >
            昵称
          </label>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            id="name"
            maxLength={200}
            name="name"
            required
          />
          <label
            className="block text-sm font-medium text-slate-800"
            htmlFor="email"
          >
            邮箱地址
          </label>
          <input
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            id="email"
            name="email"
            required
            type="email"
          />
          <button
            className="w-full rounded-md bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
            type="submit"
          >
            发送验证邮件
          </button>
        </form>
        <p className="mt-6 text-sm text-slate-600">
          已完成验证？{' '}
          <Link
            className="font-semibold text-blue-700 hover:underline"
            href="/auth/sign-in"
          >
            登录
          </Link>
        </p>
      </section>
    </main>
  );
}
