import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  const file = fileURLToPath(new URL(path, import.meta.url));
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

describe('blocked word administration UI', () => {
  it('exposes an admin-only management page with create, status, and permanent delete controls', () => {
    expect(source('../../app/admin/blocked-words/page.tsx')).toContain(
      'BlockedWordManagement',
    );
    const component = source(
      '../../components/admin/blocked-word-management.tsx',
    );
    expect(component).toContain('CREATE');
    expect(component).toContain('SET_ENABLED');
    expect(component).toContain('DELETE');
    expect(component).toContain('reason');
    expect(source('../../app/admin/layout.tsx')).toContain(
      '/admin/blocked-words',
    );
  });
});
