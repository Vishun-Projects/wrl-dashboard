'use client';

import React from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
  type AppTheme,
  APP_THEMES,
  THEME_DESCRIPTIONS,
  THEME_LABELS,
} from '@/lib/ui/theme';
import { useTheme } from '@/components/theme/ThemeProvider';
import { feedback } from '@/lib/ui/feedback';

const THEME_SWATCHES: Record<AppTheme, { canvas: string; soft: string }> = {
  white: { canvas: '#ffffff', soft: '#f8fafc' },
  cream: { canvas: '#faf9f7', soft: '#f8f7f4' },
  dark: { canvas: '#0e1116', soft: '#0a0c10' },
};

export function ThemePicker() {
  const { theme, setTheme, saving } = useTheme();

  async function handleSelect(next: AppTheme) {
    if (next === theme || saving) return;
    try {
      await setTheme(next);
      feedback.actionSuccess(`Theme set to ${THEME_LABELS[next]}`);
    } catch {
      /* setTheme shows error toast */
    }
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {APP_THEMES.map((id) => {
        const selected = theme === id;
        const swatch = THEME_SWATCHES[id];
        return (
          <button
            key={id}
            type="button"
            disabled={saving}
            onClick={() => void handleSelect(id)}
            className={`relative flex flex-col overflow-hidden rounded-xl border p-4 text-left transition-all ${
              selected
                ? 'border-slate-900 ring-2 ring-slate-900/15 shadow-sm'
                : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
            } bg-bg-canvas disabled:opacity-60`}
          >
            <div className="mb-3 flex h-14 overflow-hidden rounded-lg border border-slate-200">
              <div className="flex-1" style={{ backgroundColor: swatch.soft }} />
              <div className="w-1/2 border-l border-slate-200" style={{ backgroundColor: swatch.canvas }} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-fg-primary ui-strong">{THEME_LABELS[id]}</span>
              {selected ? (
                saving ? (
                  <Loader2 size={16} className="animate-spin text-slate-500" />
                ) : (
                  <Check size={16} className="text-slate-900" />
                )
              ) : null}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">{THEME_DESCRIPTIONS[id]}</p>
          </button>
        );
      })}
    </div>
  );
}
