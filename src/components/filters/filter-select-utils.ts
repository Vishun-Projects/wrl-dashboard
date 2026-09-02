import type { FilterSelectOption } from '@/components/filters/filter-select-types';

export const SEARCHABLE_OPTION_THRESHOLD = 6;

export function resolveFilterSelectSearchable(
  searchable: boolean | undefined,
  options: FilterSelectOption[]
): boolean {
  if (searchable !== undefined) return searchable;
  return options.length > SEARCHABLE_OPTION_THRESHOLD;
}
