import { onBeforeUnmount, ref } from 'vue'

export type ThemePreference = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

// Also read by the inline script in index.html, which applies the theme before first paint.
export const THEME_STORAGE_KEY = 'helpix.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function parsePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

/** Sets the `dark` class on <html> without animating every colour transition on the page. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.classList.add('hx-theme-switching')
  root.classList.toggle('dark', theme === 'dark')
  // Re-enable transitions after the new colours have been painted.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('hx-theme-switching')))
}

function readStoredPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

function storePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
}

export function useTheme() {
  const media = window.matchMedia(DARK_QUERY)
  const preference = ref<ThemePreference>(readStoredPreference())

  const onSystemChange = () => {
    if (preference.value === 'system') applyTheme(resolveTheme('system', media.matches))
  }
  media.addEventListener('change', onSystemChange)
  onBeforeUnmount(() => media.removeEventListener('change', onSystemChange))

  function setPreference(next: ThemePreference) {
    preference.value = next
    storePreference(next)
    applyTheme(resolveTheme(next, media.matches))
  }

  return { preference, setPreference }
}
