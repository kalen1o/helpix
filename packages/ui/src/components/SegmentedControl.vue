<script setup lang="ts" generic="T extends string">
import type { ClassValue } from 'clsx'
import { useId } from 'vue'
import { motion } from 'motion-v'
import { SPRING_MOVE } from '../motion'
import { cn } from '../lib/utils'

export interface SegmentedOption<V extends string> {
  value: V
  label: string
  /** Accessible name when the visible content is an icon. */
  title?: string
}

const model = defineModel<T>({ required: true })
const props = defineProps<{ options: SegmentedOption<T>[]; label: string; iconOnly?: boolean; class?: ClassValue }>()
defineSlots<{ option?(props: { option: SegmentedOption<T>; selected: boolean }): unknown }>()

// One thumb per control: it slides between options instead of blinking from one to the next.
const thumbId = `segmented-${useId()}`
</script>

<template>
  <div role="group" :aria-label="props.label" :class="cn('inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5 text-sm', props.class)">
    <button
      v-for="option in props.options"
      :key="option.value"
      type="button"
      :title="option.title"
      :aria-label="option.title"
      :aria-pressed="model === option.value"
      :class="cn(
        'relative rounded-[5px] font-medium transition-[color,transform] duration-150 ease-out active:scale-[0.96]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        props.iconOnly ? 'grid size-7 place-items-center' : 'px-3 py-1',
        model === option.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )"
      @click="model = option.value"
    >
      <motion.span
        v-if="model === option.value"
        :layout-id="thumbId"
        :transition="SPRING_MOVE"
        aria-hidden="true"
        class="absolute inset-0 rounded-[5px] bg-secondary"
      />
      <span class="relative grid place-items-center">
        <slot name="option" :option="option" :selected="model === option.value">{{ option.label }}</slot>
      </span>
    </button>
  </div>
</template>
