export enum ContentStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  PUBLISHED = 'PUBLISHED',
  REJECTED = 'REJECTED',
  HIDDEN = 'HIDDEN',
  ARCHIVED = 'ARCHIVED',
}

const allowedTransitions: Readonly<
  Record<ContentStatus, readonly ContentStatus[]>
> = {
  [ContentStatus.DRAFT]: [ContentStatus.PENDING, ContentStatus.ARCHIVED],
  [ContentStatus.PENDING]: [
    ContentStatus.PUBLISHED,
    ContentStatus.REJECTED,
    ContentStatus.ARCHIVED,
  ],
  [ContentStatus.PUBLISHED]: [ContentStatus.HIDDEN, ContentStatus.ARCHIVED],
  [ContentStatus.REJECTED]: [ContentStatus.DRAFT, ContentStatus.ARCHIVED],
  [ContentStatus.HIDDEN]: [ContentStatus.PUBLISHED, ContentStatus.ARCHIVED],
  [ContentStatus.ARCHIVED]: [ContentStatus.DRAFT],
};

export function transitionContentStatus(
  currentStatus: ContentStatus,
  nextStatus: ContentStatus,
): ContentStatus {
  if (!allowedTransitions[currentStatus].includes(nextStatus)) {
    throw new Error('Invalid content transition');
  }

  return nextStatus;
}
