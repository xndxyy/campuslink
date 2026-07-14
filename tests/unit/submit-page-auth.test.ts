import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  redirect: vi.fn(),
  requireVerifiedUser: vi.fn(),
}));

vi.mock('@/lib/auth/guards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/guards')>()),
  requireVerifiedUser: auth.requireVerifiedUser,
}));
vi.mock('next/navigation', () => ({ redirect: auth.redirect }));

import SubmitMarketplacePage from '@/app/submit/marketplace/page';
import SubmitResourcePage from '@/app/submit/resource/page';
import {
  AuthenticationRequiredError,
  VerificationRequiredError,
} from '@/lib/auth/guards';

const pages = [
  ['resource', SubmitResourcePage],
  ['marketplace', SubmitMarketplacePage],
] as const;
const redirectSignal = new Error('NEXT_REDIRECT');

describe('submit page authentication failures', () => {
  beforeEach(() => {
    auth.redirect.mockReset();
    auth.requireVerifiedUser.mockReset();
    auth.redirect.mockImplementation(() => {
      throw redirectSignal;
    });
  });

  it.each(
    pages.flatMap(
      ([name, page]) =>
        [
          [name, page, new AuthenticationRequiredError()],
          [name, page, new VerificationRequiredError()],
        ] as const,
    ),
  )(
    'redirects known %s authentication failures',
    async (_name, page, error) => {
      auth.requireVerifiedUser.mockRejectedValueOnce(error);

      await expect(page()).rejects.toBe(redirectSignal);
      expect(auth.redirect).toHaveBeenCalledWith('/auth/sign-in');
    },
  );

  it.each(pages)(
    'rethrows unknown %s authentication failures',
    async (_name, page) => {
      const unknownFailure = new Error('database connection timed out');
      auth.requireVerifiedUser.mockRejectedValueOnce(unknownFailure);

      await expect(page()).rejects.toBe(unknownFailure);
      expect(auth.redirect).not.toHaveBeenCalled();
    },
  );
});
