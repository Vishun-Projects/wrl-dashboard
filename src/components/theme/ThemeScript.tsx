'use client';

import { useServerInsertedHTML } from 'next/navigation';
import { DEFAULT_APP_THEME, THEME_STORAGE_KEY } from '@/lib/ui/theme';

const themeScript = `(function(){try{var k='${THEME_STORAGE_KEY}';var s=localStorage.getItem(k);var t=['white','cream','dark'].indexOf(s)>=0?s:'${DEFAULT_APP_THEME}';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='${DEFAULT_APP_THEME}';}})();`;

/**
 * Inject theme bootstrap outside the React render tree so React 19 / Next 16
 * do not warn about <script> tags inside components.
 */
export function ThemeScript() {
  useServerInsertedHTML(() => (
    <script
      id="wrl-theme-bootstrap"
      dangerouslySetInnerHTML={{ __html: themeScript }}
    />
  ));
  return null;
}
