export const userRoles = ['STUDENT', 'MODERATOR', 'ADMIN'] as const;

export type UserRole = (typeof userRoles)[number];

export function isRoleAllowed(
  role: UserRole,
  allowedRoles: readonly UserRole[],
): boolean {
  return allowedRoles.includes(role);
}
