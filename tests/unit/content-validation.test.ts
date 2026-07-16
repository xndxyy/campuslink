import { describe, expect, it } from 'vitest';

import {
  contentListQuerySchema,
  createCampusWorkSchema,
  createMarketplaceItemSchema,
  createResourceSchema,
  plainText,
  updateMarketplaceItemSchema,
  updateResourceSchema,
} from '@/lib/validation/content';

describe('content validation', () => {
  it('accepts a text-only resource with an empty summary', () => {
    expect(
      createResourceSchema.safeParse({
        assetIds: [],
        customTags: [],
        presetTagIds: [],
        summary: '',
        title: '课程提示',
      }).success,
    ).toBe(true);
  });

  it('accepts a short resource summary without requiring twenty characters', () => {
    expect(
      createResourceSchema.safeParse({
        assetIds: [],
        customTags: [],
        presetTagIds: [],
        summary: '重点',
        title: '课程提示',
      }).success,
    ).toBe(true);
  });

  it.each([
    '<img src=x onerror=alert(1)>',
    '<!--comment-->',
    '<!DOCTYPE html>',
    '<script',
    '< script',
    '<b>',
    'javascript:alert(1)',
  ])('rejects unsafe plain text syntax: %s', (value) => {
    expect(() => plainText(1, 200, 'Text').parse(value)).toThrow(
      'Text must be plain text',
    );
  });

  it('allows ordinary comparison text without treating it as markup', () => {
    expect(plainText(1, 200, 'Text').parse('x < y')).toBe('x < y');
    expect(plainText(1, 200, 'Text').parse('x < y and z > 0')).toBe(
      'x < y and z > 0',
    );
  });

  it('parses marketplace prices into exact integer cents', () => {
    expect(
      createMarketplaceItemSchema.parse({
        assetIds: ['asset_1'],
        condition: 'GOOD',
        contact: 'Campus inbox only',
        customTags: [],
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library entrance',
        presetTagIds: [],
        price: '19.99',
        title: 'Discrete mathematics textbook',
      }).priceCents,
    ).toBe(1999);

    expect(() =>
      createMarketplaceItemSchema.parse({
        assetIds: ['asset_1'],
        condition: 'GOOD',
        contact: 'Campus inbox only',
        customTags: [],
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library entrance',
        presetTagIds: [],
        price: '0.001',
        title: 'Discrete mathematics textbook',
      }),
    ).toThrow();

    expect(() =>
      createMarketplaceItemSchema.parse({
        assetIds: ['asset_1'],
        condition: 'GOOD',
        contact: 'Campus inbox only',
        customTags: [],
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library entrance',
        presetTagIds: [],
        price: '21474836.48',
        title: 'Discrete mathematics textbook',
      }),
    ).toThrow();
  });

  it('accepts strict structured tag selections for resource and marketplace creates', () => {
    const parsed = createResourceSchema.parse({
      assetIds: ['doc_1'],
      customTags: ['  高等数学  '],
      presetTagIds: ['preset_resource'],
      summary: 'Complete lecture notes with worked examples and exercises.',
      title: 'Algorithms revision notes',
    });

    expect(parsed).toMatchObject({
      customTags: ['高等数学'],
      presetTagIds: ['preset_resource'],
    });
    expect(
      createMarketplaceItemSchema.parse({
        assetIds: ['image_1'],
        condition: 'GOOD',
        contact: 'Campus inbox only',
        customTags: ['教材'],
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library entrance',
        presetTagIds: ['preset_marketplace'],
        price: '19.99',
        title: 'Discrete mathematics textbook',
      }),
    ).toMatchObject({
      customTags: ['教材'],
      presetTagIds: ['preset_marketplace'],
    });
  });

  it.each([
    ['resource create courseCode', createResourceSchema, 'courseCode'],
    ['resource create legacy tags', createResourceSchema, 'tags'],
    ['resource update courseCode', updateResourceSchema, 'courseCode'],
    ['resource update legacy tags', updateResourceSchema, 'tags'],
  ])('strictly rejects %s', (_name, schema, legacyKey) => {
    const input = {
      customTags: [],
      presetTagIds: [],
      summary: 'Complete lecture notes with worked examples and exercises.',
      title: 'Algorithms revision notes',
      ...(schema === createResourceSchema ? { assetIds: ['doc_1'] } : {}),
      [legacyKey]: legacyKey === 'tags' ? ['algorithms'] : 'CS 101',
    };

    expect(schema.safeParse(input).success).toBe(false);
  });

  it('accepts structured tag selections on resource and marketplace updates', () => {
    expect(
      updateResourceSchema.safeParse({
        customTags: ['复习'],
        presetTagIds: ['preset_resource'],
        summary: 'Complete lecture notes with worked examples and exercises.',
        title: 'Algorithms revision notes',
      }).success,
    ).toBe(true);
    expect(
      updateMarketplaceItemSchema.safeParse({
        condition: 'GOOD',
        contact: 'Campus inbox only',
        customTags: ['教材'],
        description: 'A carefully used discrete mathematics textbook.',
        pickupArea: 'North library entrance',
        presetTagIds: ['preset_marketplace'],
        price: '19.99',
        title: 'Discrete mathematics textbook',
      }).success,
    ).toBe(true);
  });

  it.each([
    [
      'resource',
      createResourceSchema,
      {
        assetIds: ['doc_1'],
        customTags: [],
        presetTagIds: [],
        summary: '<b>notes</b>',
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
        customTags: [],
        description: '<script>alert(1)</script>',
        pickupArea: 'Library',
        presetTagIds: [],
        price: '1.00',
        title: 'Used book',
      },
    ],
    [
      'campus-work',
      createCampusWorkSchema,
      {
        contact: 'Campus inbox',
        customTags: [],
        description: '<a href=x>Apply</a>',
        location: 'Campus',
        payText: '$20/hour',
        presetTagIds: [],
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
        customTags: [],
        presetTagIds: [],
        summary: 'Complete lecture notes with worked examples and exercises.',
        title: 'Algorithms revision notes',
      }),
    ).toThrow();
    expect(() =>
      createCampusWorkSchema.parse({
        campusId: 'client-controlled',
        contact: 'Campus inbox',
        customTags: [],
        description: 'Help serve students during the weekend lunch shift.',
        location: 'Student centre',
        payText: '$20/hour',
        presetTagIds: [],
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
