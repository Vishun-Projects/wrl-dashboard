export type ArcpProvisionFilters = {
  startDate: string | null;
  endDate: string | null;
  dateFilterColumn: string;
  branch: string | null;
  franchisee: string | null;
  callType: string | null;
  isHod: boolean;
  assignedOffices: string[];
};

/** One tally row = one franchisee (vendor) under a branch. */
export type ArcpProvisionAggregateRow = {
  branch_id: string;
  branch_name: string;
  franchisee_id: string;
  franchisee_name: string;
  vendor_code: string;
  qty: number;
  rate_mst: number | null;
  rate_crm: number;
  variance: number | null;
  travel_amount: number;
};

/** Claims-style summary: clubbed by category / Local-Minor within a branch. */
export type ArcpProvisionCategoryAggregateRow = {
  branch_id: string;
  branch_name: string;
  ncalltype: string;
  call_type_label: string;
  nitemcategory: string;
  item_category_label: string;
  nlocalupcountry: string;
  local_upcountry_label: string;
  is_major: boolean;
  major_minor: string;
  qty: number;
  rate_card_unit: number | null;
  rate_mst: number | null;
  rate_crm: number;
  variance: number | null;
  travel_amount: number;
};

export type ArcpProvisionDetailRow = {
  ncode: string;
  call_no: string;
  branch_id: string;
  branch_name: string;
  franchisee_id: string;
  franchisee_name: string;
  vendor_code: string;
  /** tdcalls10arcp.editedon (hot source_editedon), ISO string. */
  branch_call_approved_at: string | null;
  call_type: string;
  item_category: string;
  local_upcountry: string;
  major_minor: string;
  repair_done: string;
  ntat: number | null;
  is_travel?: boolean;
  travel_rate?: number | null;
  rate_card_unit: number | null;
  crm_charged: number;
  variance: number | null;
};

export type ArcpProvisionSummary = {
  qty: number;
  rateMst: number;
  rateCrm: number;
  variance: number;
  travelAmount: number;
  unmatchedQty: number;
};

export type ArcpProvisionOptions = {
  branches: { value: string; label: string }[];
  franchisees: { value: string; label: string }[];
  callTypes: string[];
};
