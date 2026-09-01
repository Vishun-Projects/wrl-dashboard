import { describe, expect, it } from 'vitest';
import { buildAthenaFilterSql, toList } from './filter-sql';

describe('buildAthenaFilterSql', () => {
  it('uses plural branch list and drops All', () => {
    const { whereClause, values } = buildAthenaFilterSql({
      branches: ['Delhi', 'All'],
    });
    expect(whereClause).toContain('branch_name = ANY');
    expect(values).toEqual([['Delhi']]);
  });

  it('toList ignores empty and All', () => {
    expect(toList(['All', 'Kolkata', ''])).toEqual(['Kolkata']);
    expect(toList(null)).toEqual([]);
  });
});
