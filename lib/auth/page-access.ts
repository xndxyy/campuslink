import 'server-only';

import { redirect } from 'next/navigation';

import {
  AuthenticationRequiredError,
  requireVerifiedUser,
  VerificationRequiredError,
} from './guards';

export async function requireVerifiedPageUser() {
  try {
    return await requireVerifiedUser();
  } catch (error) {
    if (
      error instanceof AuthenticationRequiredError ||
      error instanceof VerificationRequiredError
    ) {
      redirect('/auth/sign-in');
    }
    throw error;
  }
}
