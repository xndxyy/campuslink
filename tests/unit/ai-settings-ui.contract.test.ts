import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  const file = fileURLToPath(new URL(path, import.meta.url));
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

describe('AI settings UI', () => {
  it('provides model, URL, key, thresholds, and connection test controls', () => {
    expect(source('../../app/admin/ai-settings/page.tsx')).toContain(
      'AiSettingsForm',
    );
    const form = source('../../components/admin/ai-settings-form.tsx');
    for (const field of [
      'baseUrl',
      'model',
      'apiKey',
      'reviewThreshold',
      'blockThreshold',
      'timeoutMs',
    ])
      expect(form).toContain(field);
    expect(form).toContain('/api/admin/ai-settings/test');
    expect(source('../../app/admin/layout.tsx')).toContain(
      '/admin/ai-settings',
    );
  });
});
