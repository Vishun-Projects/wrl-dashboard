export const THEME_STORAGE_KEY = 'wrl-theme';

export const APP_THEMES = ['white', 'cream', 'dark'] as const;

export type AppTheme = (typeof APP_THEMES)[number];

export const DEFAULT_APP_THEME: AppTheme = 'cream';

export function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === 'string' && (APP_THEMES as readonly string[]).includes(value);
}

export function resolveAppTheme(value: unknown, fallback: AppTheme = DEFAULT_APP_THEME): AppTheme {
  return isAppTheme(value) ? value : fallback;
}

export const THEME_LABELS: Record<AppTheme, string> = {
  white: 'White',
  cream: 'Cream',
  dark: 'Dark',
};

export const THEME_DESCRIPTIONS: Record<AppTheme, string> = {
  white: 'Clean bright surfaces with cool gray accents.',
  cream: 'Warm paper tones — easy on the eyes for long sessions.',
  dark: 'Low-light friendly with slate surfaces.',
};

export function applyThemeToDocument(theme: AppTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private browsing */
  }
}
