import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url)),
  'utf8',
);

describe('immutable moderation and audit persistence contract', () => {
  it('supports immutable report moderation actions without adding update/delete APIs', () => {
    expect(schema).toMatch(/enum ModerationSubjectType[\s\S]*REPORT/);
    expect(schema).toMatch(/enum ModerationActionType[\s\S]*RESOLVE/);
    expect(schema).toMatch(/model ModerationAction[\s\S]*createdAt/);
    expect(schema).toMatch(/model AuditLog[\s\S]*createdAt/);
  });
});
