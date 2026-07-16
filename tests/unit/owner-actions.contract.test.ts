import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

describe('owner deletion controls', () => {
  const actions = source('../../components/content/owner-actions.tsx');

  it('offers a confirmed permanent delete action for every owner status', () => {
    expect(actions).toContain("method: 'DELETE'");
    expect(actions).toContain('确认永久删除这条内容吗？此操作不可撤销。');
    expect(actions).toContain('删除');
    expect(actions).toContain('router.refresh()');
    expect(actions).toContain('owner-action-danger');
  });

  it.each(['resources', 'marketplace', 'campus-work'])(
    'exposes DELETE from the %s dynamic route',
    (name) => {
      const route = source(`../../app/api/${name}/[id]/route.ts`);
      expect(route).toContain('export function DELETE');
      expect(route).toContain('handleContentDelete');
    },
  );
});
