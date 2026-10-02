<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { WidgetConfig } from '@helpix/shared/api-types'
import type { WidgetApi } from './api'
import ChatPanel from './components/ChatPanel.vue'
import Launcher from './components/Launcher.vue'
import type { Identity } from './identity'
import { useChat } from './useChat'

const props = defineProps<{ config: WidgetConfig; api: WidgetApi; widgetKey: string; state: { open: boolean }; identity: Identity }>()
const chat = useChat({ api: props.api, widgetKey: props.widgetKey, identity: props.identity })
const launcher = ref<InstanceType<typeof Launcher> | null>(null)
// Closing hands focus back to the launcher.
watch(
  () => props.state.open,
  async (open) => {
    if (open) return
    await nextTick()
    launcher.value?.focus()
  },
)
</script>

<template>
  <div class="font-sans text-foreground antialiased">
    <Transition
      enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="translate-y-2 scale-[0.98] opacity-0"
      leave-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      leave-to-class="translate-y-2 scale-[0.98] opacity-0"
    >
      <ChatPanel
        v-if="state.open"
        class="origin-bottom-right"
        :config="config"
        :messages="chat.messages.value"
        :busy="chat.busy.value"
        :signed-in="identity.customerId !== null"
        @send="chat.send"
        @retry="chat.retry"
        @new-chat="chat.newChat"
        @close="state.open = false"
      />
    </Transition>
    <Launcher ref="launcher" controls="helpix-panel" :open="state.open" :color="config.accentColor" @toggle="state.open = !state.open" />
  </div>
</template>
