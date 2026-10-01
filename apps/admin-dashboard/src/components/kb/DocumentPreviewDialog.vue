<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { KbDocumentText, KbDocumentView } from '@helpix/shared/api-types'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { saveBlob } from '@/lib/download'
import { downloadName, formatBytes, previewKind, typeLabel } from '@/lib/kb'
import { renderMarkdown } from '@/lib/markdown'

const props = defineProps<{ open: boolean; doc: KbDocumentView | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const kind = computed(() => (props.doc ? previewKind(props.doc.mimeType) : null))
const loading = ref(false)
const error = ref<string | null>(null)
const pdfUrl = ref<string | null>(null)
const html = ref('')
const text = ref('')
let file: Blob | null = null
// Bumped on every load and close, so a slow response for a previous document is ignored.
let generation = 0

function reset() {
  loading.value = false
  if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value)
  pdfUrl.value = null
  html.value = ''
  text.value = ''
  error.value = null
  file = null
}

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

async function load(doc: KbDocumentView) {
  const mine = ++generation
  reset()
  loading.value = true
  try {
    const k = previewKind(doc.mimeType)
    if (k === 'docx') {
      // Browsers cannot render DOCX; show the text the agent actually uses.
      const res = await api.get<KbDocumentText>(`/kb/documents/${doc.id}/text`)
      if (mine !== generation) return
      text.value = res.text
      return
    }
    const blob = await api.blob(`/kb/documents/${doc.id}/file`)
    if (mine !== generation) return
    file = blob
    if (k === 'pdf') pdfUrl.value = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
    else {
      const content = await blob.text()
      if (mine !== generation) return
      if (k === 'markdown') html.value = renderMarkdown(content)
      else text.value = content
    }
  } catch (e) {
    if (mine === generation) error.value = message(e, 'Could not load the preview')
  } finally {
    if (mine === generation) loading.value = false
  }
}

watch(
  () => [props.open, props.doc?.id] as const,
  ([open]) => {
    if (open && props.doc) void load(props.doc)
    else if (!open) {
      generation++
      reset()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  generation++
  reset()
})

async function download() {
  const doc = props.doc
  if (!doc) return
  try {
    saveBlob(file ?? (await api.blob(`/kb/documents/${doc.id}/file`)), downloadName(doc))
  } catch (e) {
    error.value = message(e, 'Could not download the file')
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent dialog-class="max-w-4xl">
      <DialogHeader>
        <DialogTitle class="truncate pr-8">{{ doc?.title }}</DialogTitle>
        <DialogDescription v-if="doc">
          {{ typeLabel(doc.mimeType) }} · {{ formatBytes(doc.sizeBytes) }} · {{ doc.chunkCount }} {{ doc.chunkCount === 1 ? 'chunk' : 'chunks' }}
        </DialogDescription>
      </DialogHeader>

      <p v-if="loading" class="py-12 text-center text-sm text-muted-foreground">Loading preview…</p>
      <p v-else-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
      <template v-else>
        <iframe
          v-if="kind === 'pdf' && pdfUrl"
          :src="pdfUrl"
          :title="`Preview of ${doc?.title}`"
          class="h-[70vh] w-full rounded-md border"
        />
        <!-- renderMarkdown sanitises the HTML with DOMPurify before it reaches v-html. -->
        <div v-else-if="kind === 'markdown'" class="kb-markdown max-h-[70vh] overflow-auto rounded-md border p-4" v-html="html" />
        <template v-else>
          <p v-if="kind === 'docx'" class="text-xs text-muted-foreground">
            Extracted text. Download the file to see the original formatting.
          </p>
          <pre class="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-4 font-sans text-sm">{{ text }}</pre>
        </template>
      </template>

      <DialogFooter>
        <Button variant="outline" @click="download">Download</Button>
        <Button @click="emit('update:open', false)">Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
