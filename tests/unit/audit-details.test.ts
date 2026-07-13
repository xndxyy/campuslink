import { describe, expect, it } from 'vitest';

import { auditDetailRows } from '@/components/admin/user-detail-labels';
import { sanitizeAuditDetails } from '@/lib/domain/audit-details';

describe('audit detail sanitization', () => {
  it('removes storage and object keys recursively while preserving safe governance fields', () => {
    expect(
      sanitizeAuditDetails({
        entries: [
          {
            object_key: 'private/array-object',
            reason: 'Safe array reason',
            storageKey: 'private/array-storage',
          },
        ],
        nested: {
          objectKey: 'private/nested-object',
          revokedCount: 3,
          storage_key: 'private/nested-storage',
        },
        objectKey: 'private/top-object',
        status: 'ACTIVE',
        storageKey: 'private/top-storage',
      }),
    ).toEqual({
      entries: [{ reason: 'Safe array reason' }],
      nested: { revokedCount: 3 },
      status: 'ACTIVE',
    });
  });

  it('keeps storage and object keys out of human-readable audit rows', () => {
    expect(
      auditDetailRows({
        nested: { objectKey: 'private/object', revokedCount: 2 },
        reason: 'Safe reason',
        storageKey: 'private/storage',
      }),
    ).toEqual([
      { label: '其他信息', value: '撤销会话数：2' },
      { label: '原因', value: 'Safe reason' },
    ]);
  });
});
