<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import type { WidgetConfig } from '@helpix/shared/api-types'
import { HelpixLogo } from '@helpix/ui'
import type { WidgetMessage } from '../useChat'
import Composer from './Composer.vue'
import MessageBubble from './MessageBubble.vue'

const props = defineProps<{ config: WidgetConfig; messages: WidgetMessage[]; busy: boolean }>()
defineEmits<{ send: [text: string]; retry: []; newChat: []; close: [] }>()

const root = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
onMounted(() => root.value?.querySelector('textarea')?.focus())
// Follow the newest text while it streams in.
watch(
  () => props.messages.map((m) => m.content.length).join(),
  async () => {
    await nextTick()
    list.value?.scrollTo?.({ top: list.value.scrollHeight })
  },
)
</script>

<template>
  <section
    id="helpix-panel"
    ref="root"
    data-helpix-panel
    role="dialog"
    :aria-label="`Chat with ${config.shopName}`"
    @keydown.esc="$emit('close')"
    class="fixed bottom-22 right-4 z-[2147483000] flex h-[min(640px,calc(100dvh-7rem))] w-[380px] flex-col overflow-hidden rounded-xl border border-border bg-background font-sans text-foreground shadow-[0_24px_48px_-12px_rgb(12_154_130/0.28)] max-[480px]:inset-0 max-[480px]:h-dvh max-[480px]:w-full max-[480px]:rounded-none"
  >
    <header class="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
      <h2 class="min-w-0 flex-1 truncate font-sans text-[15px] font-semibold tracking-normal">{{ config.shopName }}</h2>
      <button type="button" data-helpix-new-chat class="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" @click="$emit('newChat')">
        New chat
      </button>
      <button type="button" aria-label="Close chat" class="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" @click="$emit('close')">
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </header>

    <div ref="list" class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite">
      <MessageBubble :message="{ id: 0, role: 'assistant', content: config.greeting, tools: [], status: 'done' }" />
      <MessageBubble v-for="m in messages" :key="m.id" :message="m" @retry="$emit('retry')" />
    </div>

    <Composer :busy="busy" @send="$emit('send', $event)" />

    <footer class="flex items-center justify-center gap-1.5 pb-2.5 text-[12px] text-muted-foreground">
      <span>Powered by</span>
      <HelpixLogo class="h-auto w-[72px]" />
    </footer>
  </section>
</template>
