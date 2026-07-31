import type { WarrantyMasterQueryParams, WarrantyMasterRowDetailParams } from './types';

export function parseWarrantyMasterParams(searchParams: URLSearchParams): WarrantyMasterQueryParams {
  return {
    customer: searchParams.get('customer'),
    group: searchParams.get('group'),
    fgModel: searchParams.get('fgModel'),
    warrantyMonths: searchParams.get('warrantyMonths'),
    warrantyMonthsMin: searchParams.get('warrantyMonthsMin'),
    warrantyMonthsMax: searchParams.get('warrantyMonthsMax'),
    warrStartFrom: searchParams.get('warrStartFrom'),
    warrStartTo: searchParams.get('warrStartTo'),
    warrEndFrom: searchParams.get('warrEndFrom'),
    warrEndTo: searchParams.get('warrEndTo'),
    activeOnly: searchParams.get('activeOnly') === '1',
    q: searchParams.get('q'),
  };
}

export function warrantyMasterParamsToSearchParams(
  params: WarrantyMasterQueryParams
): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.customer) qs.set('customer', params.customer);
  if (params.group) qs.set('group', params.group);
  if (params.fgModel) qs.set('fgModel', params.fgModel);
  if (params.warrantyMonths) qs.set('warrantyMonths', params.warrantyMonths);
  if (params.warrantyMonthsMin) qs.set('warrantyMonthsMin', params.warrantyMonthsMin);
  if (params.warrantyMonthsMax) qs.set('warrantyMonthsMax', params.warrantyMonthsMax);
  if (params.warrStartFrom) qs.set('warrStartFrom', params.warrStartFrom);
  if (params.warrStartTo) qs.set('warrStartTo', params.warrStartTo);
  if (params.warrEndFrom) qs.set('warrEndFrom', params.warrEndFrom);
  if (params.warrEndTo) qs.set('warrEndTo', params.warrEndTo);
  if (params.activeOnly) qs.set('activeOnly', '1');
  if (params.q) qs.set('q', params.q);
  return qs;
}

export function parseWarrantyMasterDetailParams(
  searchParams: URLSearchParams
): { error?: string; params?: WarrantyMasterRowDetailParams } {
  const base = parseWarrantyMasterParams(searchParams);
  const customerKey = searchParams.get('customerKey') ?? '';
  const groupKey = searchParams.get('groupKey') ?? '';
  const customerName = searchParams.get('customerName') ?? '';
  const groupName = searchParams.get('groupName') ?? '';
  const rowWarrantyMonthsRaw =
    searchParams.get('rowWarrantyMonths') ?? searchParams.get('warrantyMonths');
  if (!customerName.trim() && !customerKey.trim()) {
    return { error: 'customerKey or customerName is required' };
  }
  if (!groupName.trim() && !groupKey.trim()) {
    return { error: 'groupKey or groupName is required' };
  }
  if (
    rowWarrantyMonthsRaw == null ||
    rowWarrantyMonthsRaw === '' ||
    !/^-?\d+$/.test(rowWarrantyMonthsRaw)
  ) {
    return { error: 'rowWarrantyMonths is required' };
  }
  return {
    params: {
      ...base,
      customerKey,
      groupKey,
      customerName,
      groupName,
      rowWarrantyMonths: Number(rowWarrantyMonthsRaw),
    },
  };
}
