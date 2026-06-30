'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  type AppTheme,
  applyThemeToDocument,
  resolveAppTheme,
} from '@/lib/ui/theme';
import { useUser } from '@/components/layout/DashboardLayout';
import { feedback } from '@/lib/ui/feedback';

type ThemeContextValue = {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => Promise<void>;
  saving: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

export function ThemeProvider({
  children,
  serverTheme,
}: {
  children: React.ReactNode;
  serverTheme?: unknown;
}) {
  const { userProfile, refreshProfile } = useUser();
  const [theme, setThemeState] = useState<AppTheme>(() => resolveAppTheme(serverTheme));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userProfile?.theme) return;
    const profileTheme = resolveAppTheme(userProfile.theme);
    setThemeState(profileTheme);
    applyThemeToDocument(profileTheme);
  }, [userProfile?.theme]);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const setTheme = useCallback(async (next: AppTheme) => {
    const previous = theme;
    setThemeState(next);
    applyThemeToDocument(next);

    if (!userProfile?.id) return;

    try {
      setSaving(true);
      await axios.patch('/api/profile', { theme: next }, { withCredentials: true });
      await refreshProfile();
    } catch (err: unknown) {
      setThemeState(previous);
      applyThemeToDocument(previous);
      const message =
        axios.isAxiosError(err) && typeof err.response?.data?.error === 'string'
          ? err.response.data.error
          : 'Failed to save theme';
      feedback.actionFailed(message);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [theme, userProfile?.id, refreshProfile]);

  const value = useMemo(
    () => ({ theme, setTheme, saving }),
    [theme, setTheme, saving]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
