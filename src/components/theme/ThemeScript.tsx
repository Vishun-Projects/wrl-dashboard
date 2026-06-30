import { DEFAULT_APP_THEME, THEME_STORAGE_KEY } from '@/lib/ui/theme';

const themeScript = `(function(){try{var k='${THEME_STORAGE_KEY}';var s=localStorage.getItem(k);var t=['white','cream','dark'].indexOf(s)>=0?s:'${DEFAULT_APP_THEME}';document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='${DEFAULT_APP_THEME}';}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
