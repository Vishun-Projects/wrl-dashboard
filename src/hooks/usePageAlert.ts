'use client';

import { useCallback, useState } from 'react';
import type { PageAlertVariant } from '@/components/ui/PageAlert';

export type PageAlertState = {
  variant: PageAlertVariant;
  message: string;
} | null;

export function usePageAlert() {
  const [alert, setAlert] = useState<PageAlertState>(null);

  const setError = useCallback((message: string) => {
    setAlert({ variant: 'error', message });
  }, []);

  const setWarning = useCallback((message: string) => {
    setAlert({ variant: 'warning', message });
  }, []);

  const setInfo = useCallback((message: string) => {
    setAlert({ variant: 'info', message });
  }, []);

  const clear = useCallback(() => {
    setAlert(null);
  }, []);

  return { alert, setAlert, setError, setWarning, setInfo, clear };
}
