<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { KbDocumentView } from '@helpix/shared/api-types'
import { Badge, Button, Card, EmptyState, PageHeader, StatPanel, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, vEnter } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DocumentPreviewDialog from '@/components/kb/DocumentPreviewDialog.vue'
import ReindexCard from '@/components/kb/ReindexCard.vue'
import UploadDialog from '@/components/kb/UploadDialog.vue'
import { saveBlob } from '@/lib/download'
import { formatDate } from '@/lib/format'
import { downloadName, formatBytes, hasPending, STATUS_LABEL, typeLabel } from '@/lib/kb'
import { usePolling } from '@/lib/polling'

const BADGE = { processing: 'secondary', ready: 'positive', failed: 'negative' } as const

const docs = ref<KbDocumentView[]>([])
const loaded = ref(false)
const pageError = ref<string | null>(null)
const rowError = ref<string | null>(null)
const uploadOpen = ref(false)

const counts = computed(() => {
  const by = { processing: 0, ready: 0, failed: 0 }
  for (const d of docs.value) by[d.status]++
  return by
})
const totalBytes = computed(() => docs.value.reduce((sum, d) => sum + d.sizeBytes, 0))

// Kept after the dialog closes so its title does not change while it fades out.
const toDelete = ref<KbDocumentView | null>(null)
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)

const previewDoc = ref<KbDocumentView | null>(null)
const previewOpen = ref(false)
const reindexCard = ref<InstanceType<typeof ReindexCard> | null>(null)

function openPreview(doc: KbDocumentView) {
  previewDoc.value = doc
  previewOpen.value = true
}

// Chunk totals change when documents finish processing or are deleted.
watch(
  () => docs.value.map((d) => `${d.id}:${d.status}`).join(),
  () => void reindexCard.value?.refresh(),
)

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

// Bumped on every local mutation, so a load already in flight cannot overwrite newer local state.
let generation = 0

async function load() {
  const started = generation
  try {
    const { documents } = await api.get<{ documents: KbDocumentView[] }>('/kb/documents')
    if (started !== generation) return
    docs.value = documents
    pageError.value = null
  } catch (e) {
    pageError.value = message(e, 'Could not load the knowledge base')
  } finally {
    loaded.value = true
  }
}

// Refresh while anything is processing, so statuses flip to Ready or Failed on their own.
usePolling(load, 2000, computed(() => hasPending(docs.value)))

function replace(doc: KbDocumentView) {
  generation++
  docs.value = docs.value.map((d) => (d.id === doc.id ? doc : d))
}

function onCreated(doc: KbDocumentView) {
  generation++
  docs.value = [doc, ...docs.value]
}

async function retry(doc: KbDocumentView) {
  rowError.value = null
  try {
    replace(await api.post<KbDocumentView>(`/kb/documents/${doc.id}/retry`))
  } catch (e) {
    rowError.value = message(e, 'Could not retry the document')
  }
}

async function download(doc: KbDocumentView) {
  rowError.value = null
  try {
    saveBlob(await api.blob(`/kb/documents/${doc.id}/file`), downloadName(doc))
  } catch (e) {
    rowError.value = message(e, 'Could not download the file')
  }
}

function askDelete(doc: KbDocumentView) {
  toDelete.value = doc
  deleteError.value = null
  deleteOpen.value = true
}

async function confirmDelete() {
  const doc = toDelete.value
  if (!doc) return
  deleting.value = true
  deleteError.value = null
  try {
    await api.del(`/kb/documents/${doc.id}`)
    generation++
    docs.value = docs.value.filter((d) => d.id !== doc.id)
    deleteOpen.value = false
  } catch (e) {
    deleteError.value = message(e, 'Could not delete the document')
  } finally {
    deleting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="grid gap-6">
    <PageHeader title="Knowledge base" description="Documents the agent answers from. Only your shop can see them.">
      <template #actions>
        <Button @click="uploadOpen = true">Add document</Button>
      </template>
    </PageHeader>

    <p v-if="pageError" class="text-sm text-destructive" role="alert">{{ pageError }}</p>
    <p v-if="rowError" class="text-sm text-destructive" role="alert">{{ rowError }}</p>

    <div v-if="loaded && !pageError && docs.length > 0" class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatPanel v-enter="0" label="Documents" :value="docs.length" emphasis :caption="`${formatBytes(totalBytes)} in total`" />
      <StatPanel v-enter="1" label="Ready" :value="counts.ready" caption="the agent can answer from these" />
      <StatPanel v-enter="2" label="Processing" :value="counts.processing" :caption="counts.processing > 0 ? 'updates on its own' : 'nothing in the queue'" />
      <StatPanel v-enter="3" label="Failed" :value="counts.failed" :negative="counts.failed > 0" :caption="counts.failed > 0 ? 'retry from the list below' : 'no problems'" />
    </div>

    <Card v-if="loaded && !pageError" v-enter="4" class="gap-0 overflow-hidden py-0">
      <EmptyState
        v-if="docs.length === 0"
        title="No documents yet"
        description="Upload your return policy, shipping FAQ or product notes so the agent can answer from them."
      >
        <Button @click="uploadOpen = true">Add document</Button>
      </EmptyState>
      <div v-else class="relative overflow-x-auto overflow-y-hidden">
        <Table>
          <TableHeader>
            <TableRow class="hover:bg-transparent">
              <TableHead class="pl-6">Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
              <TableHead class="pr-6"><span class="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="(doc, i) in docs" :key="doc.id" v-enter="i + 5">
              <TableCell class="max-w-72 py-3 pl-6">
                <p class="truncate font-medium" :title="doc.title">{{ doc.title }}</p>
                <p v-if="doc.status === 'failed' && doc.error" class="mt-0.5 text-xs text-destructive">{{ doc.error }}</p>
              </TableCell>
              <TableCell class="whitespace-nowrap text-muted-foreground">{{ typeLabel(doc.mimeType) }}</TableCell>
              <TableCell class="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{{ formatBytes(doc.sizeBytes) }}</TableCell>
              <TableCell>
                <Badge :variant="BADGE[doc.status]" dot>{{ STATUS_LABEL[doc.status] }}</Badge>
              </TableCell>
              <TableCell class="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{{ formatDate(doc.createdAt) }}</TableCell>
              <TableCell class="pr-6">
                <div class="flex justify-end gap-1">
                  <Button v-if="doc.status === 'failed'" variant="outline" size="sm" @click="retry(doc)">Retry</Button>
                  <Button v-if="doc.status === 'ready'" variant="ghost" size="sm" @click="openPreview(doc)">Preview</Button>
                  <Button variant="ghost" size="sm" @click="download(doc)">Download</Button>
                  <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="askDelete(doc)">Delete</Button>
                </div>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>

    <ReindexCard v-if="loaded && !pageError && docs.length > 0" ref="reindexCard" />

    <UploadDialog v-model:open="uploadOpen" @created="onCreated" />
    <DocumentPreviewDialog v-model:open="previewOpen" :doc="previewDoc" />
    <ConfirmDialog
      v-model:open="deleteOpen"
      :title="`Delete ${toDelete?.title ?? 'document'}?`"
      description="The file and everything the agent learned from it are removed. This cannot be undone."
      confirm-label="Delete"
      destructive
      :busy="deleting"
      :error="deleteError"
      @confirm="confirmDelete"
    />
  </div>
</template>
