import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

async function loadPasswordPolicy() {
  const moduleUrl = new URL('../../lib/auth/password.ts', import.meta.url);

  if (!existsSync(fileURLToPath(moduleUrl))) {
    return { isPasswordValid: () => false };
  }

  return import('@/lib/auth/password');
}

async function loadPermissions() {
  const moduleUrl = new URL('../../lib/auth/permissions.ts', import.meta.url);

  if (!existsSync(fileURLToPath(moduleUrl))) {
    return { isRoleAllowed: () => false };
  }

  return import('@/lib/auth/permissions');
}

describe('authentication foundation', () => {
  it('accepts a password with at least 12 characters and every required character class', async () => {
    const { isPasswordValid } = await loadPasswordPolicy();

    expect(isPasswordValid('SafeCampus!42')).toBe(true);
  });

  it('rejects a password missing a required character class', async () => {
    const { isPasswordValid } = await loadPasswordPolicy();

    expect(isPasswordValid('safecampuspassword')).toBe(false);
  });

  it('allows a moderator through the moderator role guard', async () => {
    const { isRoleAllowed } = await loadPermissions();

    expect(isRoleAllowed('MODERATOR', ['MODERATOR', 'ADMIN'])).toBe(true);
  });

  it('does not allow a student through the moderator role guard', async () => {
    const { isRoleAllowed } = await loadPermissions();

    expect(isRoleAllowed('STUDENT', ['MODERATOR', 'ADMIN'])).toBe(false);
  });
});
