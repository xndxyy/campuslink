import { createTagSlug } from '@/lib/validation/tags';

export interface RunScopedPublishTag {
  label: string;
  scope: 'RESOURCE' | 'MARKETPLACE' | 'CAMPUS_WORK';
  slug: string;
}

export interface PublishContentRunTags {
  campusWork: RunScopedPublishTag;
  marketplace: RunScopedPublishTag;
  resource: RunScopedPublishTag;
}

export function createPublishContentRunTags(
  runId: string,
): PublishContentRunTags {
  const token = runId
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase()
    .slice(0, 8);
  if (token.length !== 8) throw new Error('A run-scoped tag token is required');

  const tag = (
    prefix: string,
    scope: RunScopedPublishTag['scope'],
  ): RunScopedPublishTag => {
    const label = `${prefix}-${token}`;
    return Object.freeze({ label, scope, slug: createTagSlug(label) });
  };
  return Object.freeze({
    campusWork: tag('E2E工作', 'CAMPUS_WORK'),
    marketplace: tag('E2E市集', 'MARKETPLACE'),
    resource: tag('E2E资源', 'RESOURCE'),
  });
}
