<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { cn } from '../lib/utils'
import { DIALOG_OPEN } from './dialogContext'

// Matches the exit transition in globals.css (.hx-dialog), so content stays visible while it fades out.
const EXIT_MS = 150

const props = defineProps<{ class?: ClassValue }>()
const open = inject(DIALOG_OPEN)
if (!open) throw new Error('DialogContent must be used inside Dialog')

const el = ref<HTMLDialogElement | null>(null)
const rendered = ref(open.value)
let unmountTimer: ReturnType<typeof setTimeout> | undefined

function sync(value: boolean) {
  clearTimeout(unmountTimer)
  if (value) rendered.value = true
  else unmountTimer = setTimeout(() => (rendered.value = false), EXIT_MS)

  const dialog = el.value
  if (!dialog) return
  if (value && !dialog.open) dialog.showModal()
  else if (!value && dialog.open) dialog.close()
}

onMounted(() => sync(open.value))
watch(open, sync, { flush: 'post' })
onBeforeUnmount(() => clearTimeout(unmountTimer))

// Fires on Escape and on programmatic close.
function onClose() {
  open!.value = false
}

// The content wrapper fills the dialog box, so an event whose target is the <dialog> itself hit the backdrop.
// Close only on a full press on the backdrop: a text selection dragged out of the content must not close it,
// and neither may the second click of a double-click that opened it.
const OPEN_GRACE_MS = 250
let openedAt = 0
let pressStartedOnBackdrop = false

watch(open, (value) => {
  if (value) openedAt = performance.now()
})

function onPointerDown(event: PointerEvent) {
  pressStartedOnBackdrop = event.target === el.value
}

function onClick(event: MouseEvent) {
  const onBackdrop = event.target === el.value && pressStartedOnBackdrop
  pressStartedOnBackdrop = false
  if (onBackdrop && performance.now() - openedAt > OPEN_GRACE_MS) open!.value = false
}
</script>

<template>
  <dialog
    ref="el"
    class="hx-dialog m-auto w-full outline-none max-w-lg rounded-xl border bg-card p-0 text-card-foreground shadow-[0_24px_48px_-12px_rgb(16_26_24/0.28)]"
    @close="onClose"
    @pointerdown="onPointerDown"
    @click="onClick"
  >
    <div v-if="rendered" :class="cn('grid gap-4 p-6', props.class)">
      <slot />
    </div>
  </dialog>
</template>
