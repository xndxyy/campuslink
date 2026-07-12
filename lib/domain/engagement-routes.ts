import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  AuthenticationRequiredError,
  requireVerifiedUser,
  type CurrentUserResolver,
  VerificationRequiredError,
} from '@/lib/auth/guards';
import {
  createEnvironmentRateLimiter,
  type RateLimiter,
} from '@/lib/auth/rate-limit';
import { isSameOriginAuthRequest } from '@/lib/auth/request-security';
import { getDb } from '@/lib/db';

import {
  addFavourite,
  type FavouriteActor,
  FavouriteNotFoundError,
  type FavouriteTarget,
  type FavouritesAdapter,
  removeFavourite,
} from './favourites';
import {
  type MarketplaceContactActor,
  type MarketplaceContactAdapter,
  MarketplaceContactNotFoundError,
  MarketplaceContactOwnListingError,
  requestMarketplaceContact,
} from './marketplace-contact';
import {
  createReport,
  type CreateReportInput,
  type ReportActor,
  ReportDuplicateError,
  ReportNotFoundError,
  ReportOwnContentError,
  type ReportsAdapter,
} from './reports';

const targetId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const favouriteSchema = z
  .object({
    targetId,
    targetType: z.enum(['RESOURCE', 'MARKETPLACE_ITEM', 'JOB_POST']),
  })
  .strict();
const reportSchema = z
  .object({
    details: z
      .string()
      .trim()
      .max(1000)
      .refine((value) => !/[<>]/.test(value), 'Plain text only')
      .optional(),
    reason: z.enum(['SPAM', 'MISLEADING', 'HARASSMENT', 'PROHIBITED', 'OTHER']),
    targetId,
    targetType: z.enum(['RESOURCE', 'MARKETPLACE_ITEM', 'JOB_POST']),
  })
  .strict();

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' };
function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    headers: { ...noStoreHeaders, ...headers },
    status,
  });
}

function preflight(request: Request) {
  if (!isSameOriginAuthRequest(request))
    return json({ message: 'Invalid request origin.' }, 403);
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ message: 'Invalid request details.' }, 400);
  }
  return null;
}

type FavouriteMutation = (
  actor: FavouriteActor,
  target: FavouriteTarget,
  action: 'add' | 'remove',
) => Promise<unknown>;

export interface FavouriteRouteDependencies {
  mutate?: FavouriteMutation;
  resolveUser?: CurrentUserResolver;
}

async function handleFavouriteMutation(
  request: Request,
  action: 'add' | 'remove',
  dependencies: FavouriteRouteDependencies,
) {
  const failed = preflight(request);
  if (failed) return failed;
  try {
    const user = await requireVerifiedUser(dependencies.resolveUser);
    const parsed = favouriteSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return json({ message: 'Invalid favourite details.' }, 400);
    const actor = { campusId: user.campusId, id: user.id };
    const mutate =
      dependencies.mutate ??
      (async (currentActor, currentTarget, currentAction) => {
        const db = getDb() as unknown as FavouritesAdapter;
        return currentAction === 'add'
          ? addFavourite(db, currentActor, currentTarget)
          : removeFavourite(db, currentActor, currentTarget);
      });
    return json(await mutate(actor, parsed.data, action), 200);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError)
      return json({ message: error.message }, 401);
    if (error instanceof VerificationRequiredError)
      return json({ message: error.message }, 403);
    if (error instanceof FavouriteNotFoundError)
      return json({ message: error.message }, 404);
    return json({ message: 'Unable to update favourite.' }, 500);
  }
}

export function handleFavouritePost(
  request: Request,
  dependencies: FavouriteRouteDependencies = {},
) {
  return handleFavouriteMutation(request, 'add', dependencies);
}

export function handleFavouriteDelete(
  request: Request,
  dependencies: FavouriteRouteDependencies = {},
) {
  return handleFavouriteMutation(request, 'remove', dependencies);
}

export interface ReportRouteDependencies {
  create?: (actor: ReportActor, input: CreateReportInput) => Promise<unknown>;
  resolveUser?: CurrentUserResolver;
}

export async function handleReportPost(
  request: Request,
  dependencies: ReportRouteDependencies = {},
) {
  const failed = preflight(request);
  if (failed) return failed;
  try {
    const user = await requireVerifiedUser(dependencies.resolveUser);
    const parsed = reportSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return json({ message: 'Invalid report details.' }, 400);
    const actor = { campusId: user.campusId, id: user.id };
    const created = dependencies.create
      ? await dependencies.create(actor, parsed.data)
      : await createReport(
          getDb() as unknown as ReportsAdapter,
          actor,
          parsed.data,
        );
    return json(created, 201);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError)
      return json({ message: error.message }, 401);
    if (error instanceof VerificationRequiredError)
      return json({ message: error.message }, 403);
    if (error instanceof ReportOwnContentError)
      return json({ message: error.message }, 403);
    if (error instanceof ReportNotFoundError)
      return json({ message: error.message }, 404);
    if (error instanceof ReportDuplicateError)
      return json({ message: error.message }, 409);
    return json({ message: 'Unable to submit report.' }, 500);
  }
}

const contactLimiter = createEnvironmentRateLimiter({
  limit: 5,
  windowMs: 15 * 60_000,
});
export interface ContactRouteDependencies {
  contact?: (actor: MarketplaceContactActor, id: string) => Promise<unknown>;
  limiter?: RateLimiter;
  resolveUser?: CurrentUserResolver;
}

export async function handleMarketplaceContactPost(
  request: Request,
  id: string,
  dependencies: ContactRouteDependencies = {},
) {
  if (!isSameOriginAuthRequest(request))
    return json({ message: 'Invalid request origin.' }, 403);
  if (!targetId.safeParse(id).success)
    return json({ message: 'Invalid marketplace listing.' }, 400);
  try {
    const user = await requireVerifiedUser(dependencies.resolveUser);
    const rate = await (dependencies.limiter ?? contactLimiter).consume(
      `email:${user.email.toLowerCase()}`,
    );
    if (!rate.allowed) {
      return json(
        { message: 'Too many contact requests. Please try again later.' },
        429,
        { 'Retry-After': String(rate.retryAfterSeconds) },
      );
    }
    const actor = { campusId: user.campusId, id: user.id };
    const result = dependencies.contact
      ? await dependencies.contact(actor, id)
      : await requestMarketplaceContact(
          getDb() as unknown as MarketplaceContactAdapter,
          actor,
          id,
        );
    return json(result, 200);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError)
      return json({ message: error.message }, 401);
    if (error instanceof VerificationRequiredError)
      return json({ message: error.message }, 403);
    if (error instanceof MarketplaceContactOwnListingError)
      return json({ message: error.message }, 403);
    if (error instanceof MarketplaceContactNotFoundError)
      return json({ message: error.message }, 404);
    return json({ message: 'Unable to request marketplace contact.' }, 500);
  }
}
