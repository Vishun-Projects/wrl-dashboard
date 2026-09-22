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

  it('adds asp_office_id EXISTS when restricted', () => {
    const { whereClause, values } = buildAthenaFilterSql({
      isHod: false,
      assignedOffices: ['101', '102'],
    });
    expect(whereClause).toContain('asp_office_id');
    expect(whereClause).toContain('dim_offices');
    expect(values).toEqual([[101, 102]]);
  });

  it('skips office scope for HOD or empty assignedOffices', () => {
    expect(
      buildAthenaFilterSql({ isHod: true, assignedOffices: ['101'] }).whereClause
    ).not.toContain('asp_office_id');
    expect(
      buildAthenaFilterSql({ isHod: false, assignedOffices: [] }).whereClause
    ).not.toContain('asp_office_id');
  });
});
