export const ATTENDANCE_ORG_SETTINGS_KEY = 'attendance';

export type AttendanceSettings = {
  warnDistanceKm: number;
  repairDoneTypicalMinutes: Record<string, number>;
};

export const ATTENDANCE_ORG_SETTINGS_FALLBACKS: AttendanceSettings = {
  warnDistanceKm: 50,
  repairDoneTypicalMinutes: {
    'Motor Replaced': 60,
    'Compressor Replaced': 90,
    'Gas Charging Done': 45,
  },
};
