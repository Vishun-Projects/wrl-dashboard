export type UserSortKey = 'user' | 'role' | 'statuses' | 'branches' | 'misEmail';

export type AdminRole = {
  id: string | number;
  name?: string;
  permissions?: string[] | string;
  description?: string;
};

export type AdminOffice = { ncode: string | number; vcompanyname: string };

export type AdminUser = {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  role_id?: string | number;
  role_ids?: unknown;
  office_ids?: string[];
  visible_statuses?: string[];
  mis_email_enabled?: boolean;
  avatar_url?: string;
};

export type FormData = {
  name: string;
  email: string;
  password: string;
  role: string;
  role_id: string | number;
  role_ids: string[];
  office_ids: string[];
  visible_statuses: string[];
  mis_email_enabled: boolean;
};
