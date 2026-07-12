import { describe, expect, it } from 'vitest';

import {
  createJobSchema,
  createMarketplaceItemSchema,
  createResourceSchema,
} from '@/lib/validation/content';

describe('content validation', () => {
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
    ['resource', createResourceSchema, { assetIds: ['doc_1'], summary: '<b>notes</b>', tags: [], title: 'Useful notes' }],
    ['marketplace', createMarketplaceItemSchema, { assetIds: ['image_1'], condition: 'GOOD', contact: 'mail me', description: '<script>alert(1)</script>', pickupArea: 'Library', price: '1.00', title: 'Used book' }],
    ['job', createJobSchema, { company: 'Campus Cafe', description: '<a href=x>Apply</a>', location: 'Campus', payText: '$20/hour', title: 'Weekend assistant' }],
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
});
