<script setup lang="ts">
import { computed } from 'vue'
import { SegmentedControl, type SegmentedOption } from '@helpix/ui'
import { useTheme, type ThemePreference } from '@/lib/theme'

const { preference, setPreference } = useTheme()
const model = computed({ get: () => preference.value, set: setPreference })

const OPTIONS: SegmentedOption<ThemePreference>[] = [
  { value: 'light', label: 'Light', title: 'Light theme' },
  { value: 'dark', label: 'Dark', title: 'Dark theme' },
  { value: 'system', label: 'System', title: 'Match system theme' },
]
</script>

<template>
  <SegmentedControl v-model="model" :options="OPTIONS" label="Theme" icon-only>
    <template #option="{ option }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-4" aria-hidden="true">
        <template v-if="option.value === 'light'">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </template>
        <path v-else-if="option.value === 'dark'" d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        <template v-else>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </template>
      </svg>
    </template>
  </SegmentedControl>
</template>
