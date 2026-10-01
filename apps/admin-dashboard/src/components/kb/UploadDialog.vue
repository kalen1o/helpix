<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { KbDocumentView } from '@helpix/shared/api-types'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { ACCEPT_ATTR, formatBytes, validateUpload } from '@/lib/kb'

type Mode = 'file' | 'text'
const MODES: { value: Mode; label: string }[] = [
  { value: 'file', label: 'Upload file' },
  { value: 'text', label: 'Paste text' },
]

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; created: [doc: KbDocumentView] }>()

const mode = ref<Mode>('file')
const file = ref<File | null>(null)
const title = ref('')
const text = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

// Every opening starts clean.
watch(
  () => props.open,
  (open) => {
    if (!open) return
    mode.value = 'file'
    file.value = null
    title.value = ''
    text.value = ''
    error.value = null
  },
)

const canSubmit = computed(
  () => !busy.value && (mode.value === 'file' ? file.value !== null : title.value.trim() !== '' && text.value.trim() !== ''),
)

function setMode(m: Mode) {
  mode.value = m
  error.value = null
}

function onFileChange(event: Event) {
  const picked = (event.target as HTMLInputElement).files?.[0] ?? null
  error.value = picked ? validateUpload(picked) : null
  file.value = picked && !error.value ? picked : null
}

async function submit() {
  if (!canSubmit.value) return
  busy.value = true
  error.value = null
  try {
    let doc: KbDocumentView
    if (mode.value === 'file') {
      const form = new FormData()
      // The title must come before the file: the server only sees fields sent ahead of the file part.
      if (title.value.trim()) form.append('title', title.value.trim())
      form.append('file', file.value!)
      doc = await api.upload<KbDocumentView>('/kb/documents', form)
    } else {
      doc = await api.post<KbDocumentView>('/kb/documents/text', { title: title.value.trim(), text: text.value })
    }
    emit('created', doc)
    emit('update:open', false)
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : 'The upload failed. Try again.'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add to knowledge base</DialogTitle>
        <DialogDescription>The agent answers from these documents. Processing takes a few seconds.</DialogDescription>
      </DialogHeader>

      <div role="tablist" aria-label="Source" class="inline-flex w-fit rounded-lg bg-muted p-1 text-sm">
        <button
          v-for="m in MODES"
          :key="m.value"
          type="button"
          role="tab"
          :aria-selected="mode === m.value"
          class="rounded-md px-3 py-1 font-medium text-muted-foreground transition-colors aria-selected:bg-card aria-selected:text-foreground aria-selected:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="setMode(m.value)"
        >
          {{ m.label }}
        </button>
      </div>

      <form id="kb-upload" class="grid gap-4" @submit.prevent="submit">
        <div v-if="mode === 'file'" class="grid gap-2">
          <Label for="kb-file">File</Label>
          <input
            id="kb-file"
            type="file"
            :accept="ACCEPT_ATTR"
            class="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
            @change="onFileChange"
          />
          <p class="text-xs text-muted-foreground">
            PDF, DOCX, Markdown or TXT, up to 10 MB.
            <template v-if="file">Selected: {{ file.name }} ({{ formatBytes(file.size) }})</template>
          </p>
        </div>
        <div class="grid gap-2">
          <Label for="kb-title">
            Title<span v-if="mode === 'file'" class="font-normal text-muted-foreground"> (optional)</span>
          </Label>
          <Input
            id="kb-title"
            v-model="title"
            maxlength="200"
            :placeholder="mode === 'file' ? 'Defaults to the file name' : 'e.g. Return policy'"
          />
        </div>
        <div v-if="mode === 'text'" class="grid gap-2">
          <Label for="kb-text">Text</Label>
          <Textarea id="kb-text" v-model="text" rows="10" maxlength="200000" placeholder="Paste a policy, FAQ or product notes" />
        </div>
      </form>

      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
        <Button type="submit" form="kb-upload" :disabled="!canSubmit">{{ busy ? 'Adding…' : 'Add' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
