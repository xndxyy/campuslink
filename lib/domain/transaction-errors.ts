interface DriverConflictCause {
  kind?: unknown;
  originalCode?: unknown;
}

interface TransactionConflictCandidate {
  cause?: DriverConflictCause;
  code?: unknown;
  meta?: {
    code?: unknown;
    driverAdapterError?: { cause?: DriverConflictCause };
  };
}

function isDriverConflictCause(cause: DriverConflictCause | undefined) {
  return (
    cause?.originalCode === '40001' ||
    cause?.kind === 'TransactionWriteConflict'
  );
}

export function isTransactionConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as TransactionConflictCandidate;
  return (
    candidate.code === 'P2034' ||
    candidate.code === '40001' ||
    candidate.meta?.code === '40001' ||
    isDriverConflictCause(candidate.cause) ||
    isDriverConflictCause(candidate.meta?.driverAdapterError?.cause)
  );
}
