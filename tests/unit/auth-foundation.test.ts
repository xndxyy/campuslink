import { describe, expect, it } from 'vitest';

import { isPasswordValid } from '@/lib/auth/password';
import { isRoleAllowed } from '@/lib/auth/permissions';

describe('authentication foundation', () => {
  it('accepts a password with at least 12 characters and every required character class', () => {
    expect(isPasswordValid('SafeCampus!42')).toBe(true);
  });

  it('rejects a password missing a required character class', () => {
    expect(isPasswordValid('safecampuspassword')).toBe(false);
  });

  it('allows a moderator through the moderator role guard', () => {
    expect(isRoleAllowed('MODERATOR', ['MODERATOR', 'ADMIN'])).toBe(true);
  });

  it('does not allow a student through the moderator role guard', () => {
    expect(isRoleAllowed('STUDENT', ['MODERATOR', 'ADMIN'])).toBe(false);
  });
});
