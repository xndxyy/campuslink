import { describe, expect, it } from 'vitest';

import {
  TagValidationError,
  createTagSlug,
  normalizeTagLabel,
  parseTagSelectionInput,
} from '@/lib/validation/tags';

describe('tag validation API', () => {
  it('exposes normalization, slug, and strict selection parsers', async () => {
    const validation = await import('@/lib/validation/tags').catch(() => ({}));

    expect(validation).toMatchObject({
      createTagSlug: expect.any(Function),
      normalizeTagLabel: expect.any(Function),
      parseTagSelectionInput: expect.any(Function),
    });
  });

  it('normalizes NFKC and every Unicode whitespace run without truncation', () => {
    expect(normalizeTagLabel('  ＣＯＳ\u3000\t 委托  ')).toBe('COS 委托');
    expect(normalizeTagLabel('x < y')).toBe('x < y');
    expect(() => normalizeTagLabel('课'.repeat(33))).toThrowError(
      expect.objectContaining({ code: 'INVALID_LABEL' }),
    );
  });

  it.each([
    '',
    '   ',
    '<b>课程</b>',
    '<!--hidden-->',
    '<!DOCTYPE html>',
    '< script',
    'javascript:alert(1)',
    'safe\u0000unsafe',
  ])('rejects empty, HTML-like, dangerous, or control syntax: %j', (value) => {
    expect(() => normalizeTagLabel(value)).toThrow(TagValidationError);
  });

  it('creates a stable, locale-independent, bounded Unicode slug', () => {
    const variants = ['  ＣＯＳ   委托  ', 'COS 委托', 'cos\u00a0委托'];
    expect(variants.map(createTagSlug)).toEqual([
      'cos-委托',
      'cos-委托',
      'cos-委托',
    ]);
    expect(createTagSlug('Data_AI/ML')).toBe('data-ai-ml');
    expect(createTagSlug('校园二手')).toBe('校园二手');
    expect(createTagSlug('Straße')).toBe(createTagSlug('STRASSE'));
    expect(createTagSlug('A'.repeat(32))).toHaveLength(32);
    expect(() => createTagSlug('+++')).toThrowError(
      expect.objectContaining({ code: 'EMPTY_SLUG' }),
    );
  });

  it('uses full Unicode case folding without conflating Turkic dotless i', () => {
    expect(createTagSlug('Straße')).toBe(createTagSlug('STRASSE'));
    expect(createTagSlug('Σ')).toBe(createTagSlug('σ'));
    expect(createTagSlug('Σ')).toBe(createTagSlug('ς'));
    expect(createTagSlug('I')).not.toBe(createTagSlug('ı'));
    expect(createTagSlug('İ')).toBe('i̇');
    expect(createTagSlug('İ')).toBe(createTagSlug('i̇'));
    expect(createTagSlug('  ＳＴＲＡＳＳＥ\u3000 委托  ')).toBe(
      createTagSlug('strasse 委托'),
    );
  });

  it('strictly parses bounded arrays and normalized custom labels', () => {
    expect(
      parseTagSelectionInput({
        customTags: ['  ＣＯＳ   委托  ', '算法'],
        presetTagIds: ['preset_1'],
      }),
    ).toEqual({
      customTags: ['COS 委托', '算法'],
      presetTagIds: ['preset_1'],
    });

    for (const input of [
      null,
      { customTags: [], presetTagIds: [], ownerId: 'attacker' },
      { customTags: '算法', presetTagIds: [] },
      { customTags: [], presetTagIds: ['x'.repeat(192)] },
    ]) {
      expect(() => parseTagSelectionInput(input)).toThrowError(
        expect.objectContaining({ code: 'INVALID_INPUT' }),
      );
    }
  });

  it.each([
    [
      { customTags: [], presetTagIds: ['preset_1', 'preset_1'] },
      'DUPLICATE_PRESET',
    ],
    [{ customTags: ['算法', '  算法 '], presetTagIds: [] }, 'DUPLICATE_CUSTOM'],
    [{ customTags: ['AI/ML', 'AI ML'], presetTagIds: [] }, 'TAG_COLLISION'],
    [{ customTags: ['一', '二', '三'], presetTagIds: [] }, 'TOO_MANY_CUSTOM'],
    [
      {
        customTags: [],
        presetTagIds: ['1', '2', '3', '4', '5', '6'],
      },
      'TOO_MANY_TAGS',
    ],
  ])(
    'rejects duplicate, collision, and bounded selection input with %s',
    (input, code) => {
      expect(() => parseTagSelectionInput(input)).toThrowError(
        expect.objectContaining({ code }),
      );
    },
  );
});
