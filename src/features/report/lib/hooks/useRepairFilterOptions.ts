'use client';

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import type { RegisterMultiSelectOption } from '@/features/register';
import type { RepairPickerItem } from '@/features/serial-audit';

/** Loads allowlisted mstrepair picker options for the shared Repair done filter. */
export function useRepairFilterOptions(enabled = true): {
  options: RegisterMultiSelectOption[];
  labelByValue: Map<string, string>;
  loading: boolean;
} {
  const [items, setItems] = useState<RepairPickerItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await axios.get('/api/report/serial-audit/repairs', {
          withCredentials: true,
          timeout: 60000,
        });
        if (cancelled) return;
        setItems((res.data?.repairs || []) as RepairPickerItem[]);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const options = useMemo(
    () => items.map((item) => ({ value: item.value, label: item.vname })),
    [items]
  );
  const labelByValue = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) map.set(item.value, item.vname);
    return map;
  }, [items]);

  return { options, labelByValue, loading };
}
