import { describe, expect, it } from 'vitest';

import {
  ContentStatus,
  transitionContentStatus,
} from '@/lib/domain/content-status';

describe('transitionContentStatus', () => {
  it('transitions PENDING content to PUBLISHED', () => {
    expect(
      transitionContentStatus(ContentStatus.PENDING, ContentStatus.PUBLISHED),
    ).toBe(ContentStatus.PUBLISHED);
  });

  it('lets an author withdraw PENDING content by archiving it', () => {
    expect(
      transitionContentStatus(ContentStatus.PENDING, ContentStatus.ARCHIVED),
    ).toBe(ContentStatus.ARCHIVED);
  });

  it('rejects a PUBLISHED to PENDING transition', () => {
    expect(() =>
      transitionContentStatus(ContentStatus.PUBLISHED, ContentStatus.PENDING),
    ).toThrow('Invalid content transition');
  });
});
