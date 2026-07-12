import { describe, expect, it } from 'vitest';

import { appName } from '@/lib/config';

describe('application configuration', () => {
  it('identifies the application as CampusLink', () => {
    expect(appName).toBe('CampusLink');
  });
});
