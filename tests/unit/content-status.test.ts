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

  it('rejects a DRAFT to ARCHIVED transition', () => {
    expect(() =>
      transitionContentStatus(ContentStatus.DRAFT, ContentStatus.ARCHIVED),
    ).toThrow('Invalid content transition');
  });

  it('rejects a REJECTED to ARCHIVED transition', () => {
    expect(() =>
      transitionContentStatus(ContentStatus.REJECTED, ContentStatus.ARCHIVED),
    ).toThrow('Invalid content transition');
  });

  it('rejects an ARCHIVED to DRAFT transition', () => {
    expect(() =>
      transitionContentStatus(ContentStatus.ARCHIVED, ContentStatus.DRAFT),
    ).toThrow('Invalid content transition');
  });
});
