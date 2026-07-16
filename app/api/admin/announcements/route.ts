import { z } from 'zod';

import { requireRole, type CurrentUserResolver } from '@/lib/auth/guards';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';
import { adminErrorResponse, adminJson } from '@/lib/domain/admin-route';
import {
  announcementInput,
  createAnnouncement,
  deleteAnnouncement,
  type AnnouncementAdapter,
} from '@/lib/domain/announcements';
import type { StaffActor } from '@/lib/domain/moderation';
import { JsonBodyError, readBoundedJson } from '@/lib/security/request-body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const deletionInput = z
  .object({ id: z.string().trim().min(1).max(191) })
  .strict();

interface AnnouncementRouteDependencies {
  create?: (
    actor: StaffActor,
    input: z.infer<typeof announcementInput>,
  ) => Promise<unknown>;
  remove?: (actor: StaffActor, id: string) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
}

async function actorForRequest(
  dependencies: AnnouncementRouteDependencies,
): Promise<StaffActor> {
  const user = await requireRole(['ADMIN'], dependencies.resolveUser);
  return { campusId: user.campusId, id: user.id, role: user.role };
}

async function readInput(request: Request) {
  return readBoundedJson(request).catch((error) => error);
}

export async function handleAnnouncementPost(
  request: Request,
  dependencies: AnnouncementRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return adminJson({ message: '请求来源无效。' }, { status: 403 });
  }
  try {
    const actor = await actorForRequest(dependencies);
    const body = await readInput(request);
    if (body instanceof JsonBodyError) {
      return adminJson(
        { message: '公告请求无效。' },
        { status: body.status },
      );
    }
    const parsed = announcementInput.safeParse(body);
    if (!parsed.success) {
      return adminJson(
        { message: '公告请求无效。' },
        { status: 400 },
      );
    }
    const result = dependencies.create
      ? await dependencies.create(actor, parsed.data)
      : await createAnnouncement(
          getDb() as unknown as AnnouncementAdapter,
          actor,
          parsed.data,
        );
    return adminJson(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function handleAnnouncementDelete(
  request: Request,
  dependencies: AnnouncementRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request)) {
    return adminJson({ message: '请求来源无效。' }, { status: 403 });
  }
  try {
    const actor = await actorForRequest(dependencies);
    const body = await readInput(request);
    if (body instanceof JsonBodyError) {
      return adminJson(
        { message: '公告请求无效。' },
        { status: body.status },
      );
    }
    const parsed = deletionInput.safeParse(body);
    if (!parsed.success) {
      return adminJson(
        { message: '公告请求无效。' },
        { status: 400 },
      );
    }
    const result = dependencies.remove
      ? await dependencies.remove(actor, parsed.data.id)
      : await deleteAnnouncement(
          getDb() as unknown as AnnouncementAdapter,
          actor,
          parsed.data.id,
        );
    return adminJson(result);
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export function POST(request: Request) {
  return handleAnnouncementPost(request);
}

export function DELETE(request: Request) {
  return handleAnnouncementDelete(request);
}
