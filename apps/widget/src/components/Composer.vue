<script setup lang="ts">
import { ref } from 'vue'
import { CHAT_MESSAGE_MAX } from '@helpix/shared/chat'

const props = defineProps<{ busy: boolean }>()
const emit = defineEmits<{ send: [text: string] }>()
const text = ref('')

function submit() {
  if (props.busy || !text.value.trim()) return
  emit('send', text.value)
  text.value = ''
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <form class="flex items-end gap-2 border-t border-border p-3" @submit.prevent="submit">
    <label class="sr-only" for="helpix-composer">Message</label>
    <textarea
      id="helpix-composer"
      v-model="text"
      rows="1"
      :maxlength="CHAT_MESSAGE_MAX"
      placeholder="Ask a question"
      class="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-sm max-[480px]:text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
      @keydown="onKeydown"
    />
    <button
      type="submit"
      :disabled="busy || !text.trim()"
      class="h-10 rounded-md bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      Send
    </button>
  </form>
</template>
