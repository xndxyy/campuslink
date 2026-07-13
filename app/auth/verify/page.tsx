import Link from 'next/link';

interface VerifyPageProps {
  searchParams: Promise<{ error?: string; sent?: string; token?: string }>;
}

export default async function VerifyPage({ searchParams }: VerifyPageProps) {
  const { error, sent, token } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-bold text-slate-950">
          Verify your e-mail
        </h1>
        {sent ? (
          <p
            className="mt-4 rounded-md bg-blue-50 p-3 text-sm text-blue-900"
            role="status"
          >
            If your registration is eligible, check your e-mail inbox for a
            verification link.
          </p>
        ) : null}
        {error ? (
          <p
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {error === 'rate-limit'
              ? 'Please wait a little before trying again.'
              : 'This verification link is invalid or has expired.'}
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
              Choose a password to activate the verified CampusLink account.
            </p>
            <label
              className="block text-sm font-medium text-slate-800"
              htmlFor="password"
            >
              Password
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
              Confirm password
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
              At least 12 characters, including upper- and lower-case letters, a
              number, and a symbol.
            </p>
            <button
              className="mt-4 w-full rounded-md bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
              type="submit"
            >
              Verify e-mail
            </button>
          </form>
        ) : (
          <>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              Open the verification link from your e-mail to finish
              registration.
            </p>
            <form
              action="/api/auth/resend-verification"
              className="mt-6 space-y-3"
              method="post"
            >
              <label
                className="block text-sm font-medium text-slate-800"
                htmlFor="email"
              >
                Need another link? Enter your e-mail address
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
                className="w-full rounded-md border border-blue-700 px-4 py-2 font-semibold text-blue-700 hover:bg-blue-50"
                type="submit"
              >
                Resend verification link
              </button>
            </form>
          </>
        )}
        <p className="mt-6 text-sm text-slate-600">
          <Link
            className="font-semibold text-blue-700 hover:underline"
            href="/auth/sign-in"
          >
            Back to sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
