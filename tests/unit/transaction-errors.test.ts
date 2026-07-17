import { describe, expect, it } from 'vitest';

import { isTransactionConflict } from '@/lib/domain/transaction-errors';

describe('transaction conflict detection', () => {
  it.each([
    { code: 'P2034' },
    { code: '40001' },
    { meta: { code: '40001' } },
    { cause: { originalCode: '40001' }, name: 'DriverAdapterError' },
    {
      cause: { kind: 'TransactionWriteConflict' },
      name: 'DriverAdapterError',
    },
    {
      code: 'P2010',
      meta: {
        driverAdapterError: { cause: { originalCode: '40001' } },
      },
    },
    {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: { kind: 'TransactionWriteConflict' },
        },
      },
    },
  ])('recognizes retryable transaction conflict %#', (error) => {
    expect(isTransactionConflict(error)).toBe(true);
  });

  it.each([
    null,
    '40001',
    { code: 'P2002' },
    { cause: { originalCode: '23505' } },
    { meta: { driverAdapterError: { cause: { kind: 'Other' } } } },
  ])('rejects unrelated error %#', (error) => {
    expect(isTransactionConflict(error)).toBe(false);
  });
});
