/** Deployment Completion / Call Register — fixed account scope (CRM Client names). */
export const CALL_REGISTER_CLIENTS = [
  'UB',
  'Nestle',
  'ABInBeV',
  'MARS',
  'Redbull',
  'Carlsberg',
  'Ferrero',
  'Reliance',
  'Reliance Campa Cola',
] as const;

export type CallRegisterClient = (typeof CALL_REGISTER_CLIENTS)[number];

export function isCallRegisterClient(value: string): value is CallRegisterClient {
  return (CALL_REGISTER_CLIENTS as readonly string[]).includes(value.trim());
}
