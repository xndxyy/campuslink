import { describe, expect, it } from 'vitest';

import {
  contentListQuerySchema,
  createJobSchema,
  createMarketplaceItemSchema,
  createResourceSchema,
  plainText,
} from '@/lib/validation/content';

describe('content validation', () => {
  it.each([
    '<img src=x onerror=alert(1)>',
    '<!--comment-->',
    '<!DOCTYPE html>',
    '<script',
    '<b>',
    'javascript:alert(1)',
  ])('rejects unsafe plain text syntax: %s', (value) => {
    expect(() => plainText(1, 200, 'Text').parse(value)).toThrow(
      'Text must be plain text',
    );
  });

  it('allows ordinary comparison text without treating it as markup', () => {
    expect(plainText(1, 200, 'Text').parse('x < y')).toBe('x < y');
  });

  it('parses marketplace prices into exact integer cents', () => {
    expect(
      createMarketplaceItemSchema.parse({
        assetIds: ['asset_1'],
        condition: 'GOOD',
        contact: 'Campus inbox only',
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library entrance',
        price: '19.99',
        title: 'Discrete mathematics textbook',
      }).priceCents,
    ).toBe(1999);

    expect(() =>
      createMarketplaceItemSchema.parse({
        assetIds: ['asset_1'],
        condition: 'GOOD',
        contact: 'Campus inbox only',
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library entrance',
        price: '0.001',
        title: 'Discrete mathematics textbook',
      }),
    ).toThrow();

    expect(() =>
      createMarketplaceItemSchema.parse({
        assetIds: ['asset_1'],
        condition: 'GOOD',
        contact: 'Campus inbox only',
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library entrance',
        price: '21474836.48',
        title: 'Discrete mathematics textbook',
      }),
    ).toThrow();
  });

  it('normalizes and deduplicates bounded resource tags and course codes', () => {
    const parsed = createResourceSchema.parse({
      assetIds: ['doc_1'],
      courseCode: ' cs 101 ',
      summary: 'Complete lecture notes with worked examples and exercises.',
      tags: [' Algorithms ', 'algorithms', ' Exam '],
      title: 'Algorithms revision notes',
    });

    expect(parsed.courseCode).toBe('CS 101');
    expect(parsed.tags).toEqual(['algorithms', 'exam']);
  });

  it.each([
    [
      'resource',
      createResourceSchema,
      {
        assetIds: ['doc_1'],
        summary: '<b>notes</b>',
        tags: [],
        title: 'Useful notes',
      },
    ],
    [
      'marketplace',
      createMarketplaceItemSchema,
      {
        assetIds: ['image_1'],
        condition: 'GOOD',
        contact: 'mail me',
        description: '<script>alert(1)</script>',
        pickupArea: 'Library',
        price: '1.00',
        title: 'Used book',
      },
    ],
    [
      'job',
      createJobSchema,
      {
        company: 'Campus Cafe',
        description: '<a href=x>Apply</a>',
        location: 'Campus',
        payText: '$20/hour',
        title: 'Weekend assistant',
      },
    ],
  ])('rejects HTML-like input for %s content', (_name, schema, value) => {
    expect(() => schema.parse(value)).toThrow();
  });

  it('enforces asset and text limits and rejects unknown keys', () => {
    expect(() =>
      createResourceSchema.parse({
        assetIds: Array.from({ length: 9 }, (_, index) => `asset_${index}`),
        summary: 'Complete lecture notes with worked examples and exercises.',
        tags: [],
        title: 'Algorithms revision notes',
      }),
    ).toThrow();
    expect(() =>
      createJobSchema.parse({
        campusId: 'client-controlled',
        company: 'Campus Cafe',
        description: 'Help serve students during the weekend lunch shift.',
        location: 'Student centre',
        payText: '$20/hour',
        title: 'Weekend assistant',
      }),
    ).toThrow();
  });

  it('caps stable page depth and search input cost', () => {
    expect(
      contentListQuerySchema.parse({ page: '50', search: 'a'.repeat(80) }),
    ).toMatchObject({ page: 50 });
    expect(() => contentListQuerySchema.parse({ page: '51' })).toThrow();
    expect(() =>
      contentListQuerySchema.parse({ search: 'a'.repeat(81) }),
    ).toThrow();
  });
});
