export const appName = 'CampusLink';

export function getDefaultCampusSlug(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.DEFAULT_CAMPUS_SLUG?.trim() || 'campuslink';
}
