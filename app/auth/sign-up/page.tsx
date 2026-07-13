import Link from 'next/link';

interface SignUpPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <section className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-2xl font-bold text-slate-950">Create an account</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Enter any valid email address. We will send a verification link before
          you choose a password and activate the account.
        </p>
        {error ? (
          <p
            className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {error === 'rate-limit'
              ? 'Please wait a little before trying again.'
              : 'Please check your registration details and try again.'}
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
            Name
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
            Email address
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
            Send verification link
          </button>
        </form>
        <p className="mt-6 text-sm text-slate-600">
          Already verified?{' '}
          <Link
            className="font-semibold text-blue-700 hover:underline"
            href="/auth/sign-in"
          >
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
