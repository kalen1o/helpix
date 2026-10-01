<script setup lang="ts">
import type { ClassValue } from 'clsx'
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSheetDrag } from '../lib/sheet'
import { cn } from '../lib/utils'
import { DIALOG_OPEN } from './dialogContext'

// Matches the exit transition in globals.css (.hx-dialog), so content stays visible while it leaves.
const EXIT_MS = 200
// Below Tailwind's `sm` breakpoint the dialog is a bottom sheet (see .hx-dialog in globals.css).
const SHEET_QUERY = '(max-width: 639.98px)'

const props = defineProps<{ class?: ClassValue; dialogClass?: ClassValue }>()
const open = inject(DIALOG_OPEN)
if (!open) throw new Error('DialogContent must be used inside Dialog')

const el = ref<HTMLDialogElement | null>(null)
const rendered = ref(open.value)
/** A sheet whose content fits can be dragged from anywhere; a scrolling one only from its grab strip. */
const draggableBody = ref(false)
let unmountTimer: ReturnType<typeof setTimeout> | undefined

const isSheet = () => typeof window.matchMedia === 'function' && window.matchMedia(SHEET_QUERY).matches
const sheet = useSheetDrag(el, { enabled: isSheet, onDismiss: () => (open!.value = false) })

/** Grow out of the control that opened the dialog, and shrink back into it on close. */
function anchorToTrigger(dialog: HTMLDialogElement, trigger: Element | null) {
  if (!(trigger instanceof HTMLElement) || trigger === document.body || isSheet()) {
    dialog.style.transformOrigin = ''
    return
  }
  const t = trigger.getBoundingClientRect()
  const d = dialog.getBoundingClientRect()
  dialog.style.transformOrigin = `${t.left + t.width / 2 - d.left}px ${t.top + t.height / 2 - d.top}px`
}

function sync(value: boolean) {
  clearTimeout(unmountTimer)
  if (value) rendered.value = true
  else unmountTimer = setTimeout(() => (rendered.value = false), EXIT_MS)

  const dialog = el.value
  if (!dialog) return
  if (value && !dialog.open) {
    const trigger = document.activeElement
    sheet.reset()
    dialog.showModal()
    anchorToTrigger(dialog, trigger)
    draggableBody.value = dialog.scrollHeight <= dialog.clientHeight + 1
  } else if (!value && dialog.open) {
    dialog.close()
  }
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
// and neither may the second click of a double-click that opened it, or the click that ends a sheet drag.
const OPEN_GRACE_MS = 250
let openedAt = 0
let pressStartedOnBackdrop = false

watch(open, (value) => {
  if (value) openedAt = performance.now()
})

function onPointerDown(event: PointerEvent) {
  pressStartedOnBackdrop = event.target === el.value
  sheet.handlers.onPointerdown(event)
}

function onClick(event: MouseEvent) {
  const onBackdrop = event.target === el.value && pressStartedOnBackdrop && !sheet.didDrag()
  pressStartedOnBackdrop = false
  if (onBackdrop && performance.now() - openedAt > OPEN_GRACE_MS) open!.value = false
}
</script>

<template>
  <dialog
    ref="el"
    data-sheet-scroll
    :class="cn(
      'hx-dialog m-auto w-full outline-none max-w-lg rounded-xl border bg-card p-0 text-card-foreground shadow-[0_24px_48px_-12px_rgb(16_26_24/0.28)]',
      draggableBody && 'max-sm:touch-none',
      props.dialogClass,
    )"
    @close="onClose"
    @pointerdown="onPointerDown"
    @pointermove="sheet.handlers.onPointermove"
    @pointerup="sheet.handlers.onPointerup"
    @pointercancel="sheet.handlers.onPointercancel"
    @click="onClick"
  >
    <!-- Grab strip: only on the bottom sheet. Decorative; Escape and the Cancel buttons stay the accessible way out. -->
    <div data-sheet-grab aria-hidden="true" class="sticky top-0 z-10 flex h-6 touch-none justify-center bg-card pt-2 sm:hidden">
      <span class="h-1 w-9 rounded-full bg-border" />
    </div>
    <div v-if="rendered" :class="cn('grid gap-4 p-6 max-sm:pt-2', props.class)">
      <slot />
    </div>
  </dialog>
</template>
