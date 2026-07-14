export interface CampusWorkContactActor {
  campusId: string;
  id: string;
}

export interface CampusWorkContactAdapter {
  $transaction<T>(
    operation: (tx: CampusWorkContactAdapter) => Promise<T>,
    options?: { isolationLevel: 'Serializable' },
  ): Promise<T>;
  auditLog: {
    create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  campusWorkPost: {
    findFirst(
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null>;
  };
}

export class CampusWorkContactNotFoundError extends Error {
  constructor() {
    super('Published campus work was not found');
  }
}

export class CampusWorkContactOwnListingError extends Error {
  constructor() {
    super('Cannot request contact for own campus work');
  }
}

export async function requestCampusWorkContact(
  adapter: CampusWorkContactAdapter,
  actor: CampusWorkContactActor,
  campusWorkPostId: string,
) {
  return adapter.$transaction(
    async (tx) => {
      const listing = await tx.campusWorkPost.findFirst({
        select: { authorId: true, contact: true, id: true },
        where: {
          campusId: actor.campusId,
          id: campusWorkPostId,
          status: 'PUBLISHED',
        },
      });
      if (!listing || typeof listing.contact !== 'string' || !listing.contact) {
        throw new CampusWorkContactNotFoundError();
      }
      if (listing.authorId === actor.id) {
        throw new CampusWorkContactOwnListingError();
      }

      await tx.auditLog.create({
        data: {
          action: 'CAMPUS_WORK_CONTACT_VIEWED',
          actorId: actor.id,
          campusId: actor.campusId,
          subjectId: campusWorkPostId,
          subjectType: 'JOB_POST',
        },
        select: { id: true },
      });
      return { contact: listing.contact };
    },
    { isolationLevel: 'Serializable' },
  );
}
