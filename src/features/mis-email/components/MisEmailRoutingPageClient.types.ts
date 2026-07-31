export type ClientSourceMode = 'mail' | 'crm';

export type RoutingRuleRow = {
  id: string;
  zone: string;
  branch: string;
  client: string;
  clientSourceMode: ClientSourceMode;
  toEmails: string[];
  ccEmails: string[];
  autoSendEnabled: boolean;
  scheduleAnchorTimeIst: string;
  scheduleIntervalMinutes: number;
  scheduleDaysOfWeek: string[];
  scheduleWindowStartIst: string | null;
  scheduleWindowEndIst: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EditableRuleRow = {
  id: string;
  zone: string[];
  branch: string[];
  client: string[];
  clientSourceMode: ClientSourceMode;
  toEmailsCsv: string;
  ccEmailsCsv: string;
  autoSendEnabled: boolean;
  scheduleAnchorTimeIst: string;
  scheduleIntervalMinutes: number;
  scheduleDaysOfWeek: string[];
  scheduleWindowStartIst: string;
  scheduleWindowEndIst: string;
};

export type RoutingOptionsResponse = {
  zones: string[];
  branches: string[];
  clients: string[];
};

export type RoutingSortKey =
  | 'priority'
  | 'zone'
  | 'branch'
  | 'client'
  | 'clientSourceMode'
  | 'to'
  | 'cc'
  | 'schedule'
  | 'autoSend';
