import { z } from 'zod';

export const registerQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  officeId: z.string().optional(),
  callType: z.string().nullable().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  dateFilterColumn: z.string().optional(),
  status: z.string().optional(),
  account: z.string().optional(),
  region: z.string().optional(),
  pincode: z.string().optional(),
  priority: z.string().optional(),
  portalFilter: z.string().optional(),
  repair: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  branch: z.string().optional(),
  franchisee: z.string().optional(),
  technician: z.string().optional(),
  fetchTotals: z.enum(['true', 'false']).optional(),
  fetchFilterOptions: z.enum(['true', 'false']).optional(),
});

export const summaryQuerySchema = z.object({
  officeId: z.string().optional(),
  callType: z.string().nullable().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  agingAsOf: z.string().optional(),
});

export const drilldownBodySchema = z.object({
  type: z.string().min(1),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  agingAsOf: z.string().optional(),
  officeId: z.coerce.string().optional(),
  callType: z.string().optional(),
  status: z.string().optional(),
  account: z.string().optional(),
  region: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  branch: z.string().optional(),
  franchisee: z.string().optional(),
  technician: z.string().optional(),
});
