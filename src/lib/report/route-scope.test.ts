import { describe, expect, it } from 'vitest';
import {
  routeNeedsCorpusPreload,
  routeNeedsSharedResources,
} from './route-scope';

describe('route-scope', () => {
  it('limits corpus preload to MIS and distribution routes', () => {
    expect(routeNeedsCorpusPreload('/report')).toBe(true);
    expect(routeNeedsCorpusPreload('/report/distribution')).toBe(true);
    expect(routeNeedsCorpusPreload('/report/arcp-claims')).toBe(false);
    expect(routeNeedsCorpusPreload('/report/warranty-master')).toBe(false);
  });

  it('loads shared resources for filter-heavy report routes', () => {
    expect(routeNeedsSharedResources('/report/arcp-claims')).toBe(true);
    expect(routeNeedsSharedResources('/report/warranty-master')).toBe(false);
  });
});
