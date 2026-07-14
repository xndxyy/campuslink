import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { createDbClient } from '@/lib/db';
import {
  createPresetTag,
  promoteCustomTag,
  resolveContentTags,
  setTagActive,
  type TagAdapter,
} from '@/lib/domain/tags';
import { TagValidationError } from '@/lib/validation/tags';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);

describeWithDatabase('governed tag persistence', () => {
  it('creates, reuses, disables, promotes, audits, and rolls back scoped definitions', async ({
    skip,
  }) => {
    const db = createDbClient();
    const availability = await db.$queryRawUnsafe<
      Array<{ hasSubject: boolean; tagTable: string | null }>
    >(`
      SELECT
        to_regclass('"TagDefinition"')::text AS "tagTable",
        EXISTS (
          SELECT 1
          FROM pg_enum value
          JOIN pg_type type ON type.oid = value.enumtypid
          WHERE type.typname = 'ModerationSubjectType'
            AND value.enumlabel = 'TAG_DEFINITION'
        ) AS "hasSubject"
    `);
    if (!availability[0]?.tagTable || !availability[0].hasSubject) {
      await db.$disconnect();
      skip('live schema is missing the expand-only tag migrations');
      return;
    }

    const campusIds: string[] = [];
    const userIds: string[] = [];
    try {
      const suffix = randomUUID();
      const campus = await db.campus.create({
        data: { name: 'Tag Governance Campus', slug: `tag-${suffix}` },
      });
      campusIds.push(campus.id);
      const otherCampus = await db.campus.create({
        data: { name: 'Other Tag Campus', slug: `tag-other-${suffix}` },
      });
      campusIds.push(otherCampus.id);
      const admin = await db.user.create({
        data: {
          campusId: campus.id,
          email: `tag-admin-${suffix}@example.edu`,
          emailVerifiedAt: new Date(),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      userIds.push(admin.id);
      const otherAdmin = await db.user.create({
        data: {
          campusId: otherCampus.id,
          email: `tag-other-admin-${suffix}@example.edu`,
          emailVerifiedAt: new Date(),
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });
      userIds.push(otherAdmin.id);
      const actor = {
        campusId: campus.id,
        emailVerifiedAt: admin.emailVerifiedAt!,
        id: admin.id,
        role: 'ADMIN' as const,
        status: 'ACTIVE' as const,
      };
      const adapter = db as unknown as TagAdapter;

      const first = await resolveContentTags(adapter, actor, 'RESOURCE', {
        customTags: ['  ＣＯＳ   委托 '],
        presetTagIds: [],
      });
      const reused = await resolveContentTags(adapter, actor, 'RESOURCE', {
        customTags: ['cos 委托'],
        presetTagIds: [],
      });
      expect(reused).toEqual(first);
      expect(
        await db.tagDefinition.count({
          where: { campusId: campus.id, scope: 'RESOURCE', slug: 'cos-委托' },
        }),
      ).toBe(1);

      await setTagActive(adapter, actor, {
        active: false,
        reason: 'Disable after campus governance review.',
        scope: 'RESOURCE',
        tagId: first[0],
      });
      await expect(
        resolveContentTags(adapter, actor, 'RESOURCE', {
          customTags: ['COS 委托'],
          presetTagIds: [],
        }),
      ).rejects.toBeInstanceOf(TagValidationError);
      await promoteCustomTag(adapter, actor, {
        reason: 'Promote a historically common campus label.',
        scope: 'RESOURCE',
        tagId: first[0],
      });
      await expect(
        db.tagDefinition.findUnique({ where: { id: first[0] } }),
      ).resolves.toMatchObject({ isActive: false, isPreset: true });

      const preset = await createPresetTag(adapter, actor, {
        label: '课程资料',
        reason: 'Provide a reviewed default resource label.',
        scope: 'RESOURCE',
      });
      await expect(
        createPresetTag(adapter, actor, {
          label: '课程资料',
          reason: 'A duplicate scoped label must conflict.',
          scope: 'MARKETPLACE',
        }),
      ).resolves.toMatchObject({ label: '课程资料' });
      await expect(
        createPresetTag(
          adapter,
          {
            campusId: otherCampus.id,
            id: otherAdmin.id,
            role: 'ADMIN',
          },
          {
            label: '课程资料',
            reason: 'Other campuses own an independent namespace.',
            scope: 'RESOURCE',
          },
        ),
      ).resolves.toMatchObject({ label: '课程资料' });

      const audit = await db.auditLog.findFirst({
        where: { action: 'TAG_CREATED', subjectId: preset.id },
      });
      expect(audit).toMatchObject({
        campusId: campus.id,
        subjectType: 'TAG_DEFINITION',
      });
      expect(audit?.details).toEqual({
        reason: 'Provide a reviewed default resource label.',
        scope: 'RESOURCE',
        to: 'PRESET_ACTIVE',
      });
      expect(JSON.stringify(audit?.details)).not.toContain('课程资料');

      const rollbackLabel = `rollback-${suffix}`.slice(0, 32);
      const rollbackAdapter: TagAdapter = {
        $transaction: (operation, options) =>
          db.$transaction(
            (tx) =>
              operation({
                $transaction: () => {
                  throw new Error('nested transaction is not expected');
                },
                auditLog: {
                  create: async () => {
                    throw new Error('forced audit failure');
                  },
                },
                tagDefinition:
                  tx.tagDefinition as unknown as TagAdapter['tagDefinition'],
              }),
            options,
          ),
        auditLog: db.auditLog as unknown as TagAdapter['auditLog'],
        tagDefinition:
          db.tagDefinition as unknown as TagAdapter['tagDefinition'],
      };
      await expect(
        createPresetTag(rollbackAdapter, actor, {
          label: rollbackLabel,
          reason: 'Force transaction rollback after tag insert.',
          scope: 'RESOURCE',
        }),
      ).rejects.toThrow('forced audit failure');
      expect(
        await db.tagDefinition.findFirst({
          where: { campusId: campus.id, label: rollbackLabel },
        }),
      ).toBeNull();
    } finally {
      if (campusIds.length > 0) {
        await db.auditLog.deleteMany({
          where: { campusId: { in: campusIds } },
        });
        await db.tagDefinition.deleteMany({
          where: { campusId: { in: campusIds } },
        });
      }
      if (userIds.length > 0) {
        await db.user.deleteMany({ where: { id: { in: userIds } } });
      }
      if (campusIds.length > 0) {
        await db.campus.deleteMany({ where: { id: { in: campusIds } } });
      }
      await db.$disconnect();
    }
  });
});
