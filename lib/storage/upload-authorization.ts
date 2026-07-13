import type { UserRole } from '@/lib/auth/permissions';
import type { UploadKind } from '@/lib/validation/upload';

function assertNever(value: never): never {
  throw new Error(`Unhandled upload kind: ${String(value)}`);
}

export function canCreateUploadIntent(
  role: UserRole,
  kind: UploadKind,
): boolean {
  switch (kind) {
    case 'ANNOUNCEMENT_IMAGE':
      return role === 'ADMIN';
    case 'MARKETPLACE_IMAGE':
    case 'RESOURCE_DOCUMENT':
    case 'RESOURCE_IMAGE':
      return true;
    default:
      return assertNever(kind);
  }
}
