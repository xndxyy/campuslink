import { describe, expect, it } from 'vitest';

import {
  requireRole,
  requireUser,
  requireVerifiedUser,
} from '@/lib/auth/guards';

const verifiedModerator = {
  campusId: 'campus_1',
  id: 'user-id',
  email: 'moderator@campuslink.edu',
  emailVerifiedAt: new Date(),
  name: 'Campus Moderator',
  role: 'MODERATOR' as const,
  status: 'ACTIVE' as const,
};

describe('server auth guards', () => {
  it('requires an authenticated user', async () => {
    await expect(requireUser(async () => null)).rejects.toThrow(
      'Authentication is required',
    );
  });

  it('allows a verified active user', async () => {
    await expect(
      requireVerifiedUser(async () => verifiedModerator),
    ).resolves.toEqual(verifiedModerator);
  });

  it('allows only the requested role', async () => {
    await expect(
      requireRole(['MODERATOR', 'ADMIN'], async () => verifiedModerator),
    ).resolves.toEqual(verifiedModerator);
    await expect(
      requireRole(['ADMIN'], async () => verifiedModerator),
    ).rejects.toThrow('Insufficient permissions');
  });

  it('does not treat a pending user as verified', async () => {
    await expect(
      requireVerifiedUser(async () => ({
        ...verifiedModerator,
        emailVerifiedAt: null,
        status: 'PENDING_VERIFICATION' as const,
      })),
    ).rejects.toThrow('A verified account is required');
  });
});
