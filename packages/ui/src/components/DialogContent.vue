<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { inject, onMounted, ref, watch } from 'vue'
import { cn } from '../lib/utils'
import { DIALOG_OPEN } from './dialogContext'

const props = defineProps<{ class?: ClassValue }>()
const open = inject(DIALOG_OPEN)
if (!open) throw new Error('DialogContent must be used inside Dialog')

const el = ref<HTMLDialogElement | null>(null)

function sync(value: boolean) {
  const dialog = el.value
  if (!dialog) return
  if (value && !dialog.open) dialog.showModal()
  else if (!value && dialog.open) dialog.close()
}

onMounted(() => sync(open.value))
watch(open, sync, { flush: 'post' })

// Fires on Escape and on programmatic close.
function onClose() {
  open!.value = false
}

// The content wrapper fills the dialog box, so a click whose target is the <dialog> itself hit the backdrop.
function onClick(event: MouseEvent) {
  if (event.target === el.value) open!.value = false
}
</script>

<template>
  <dialog
    ref="el"
    class="m-auto w-full max-w-lg rounded-lg border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
    @close="onClose"
    @click="onClick"
  >
    <div v-if="open" :class="cn('grid gap-4 p-6', props.class)">
      <slot />
    </div>
  </dialog>
</template>
