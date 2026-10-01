<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { TenantView } from '@helpix/shared/api-types'
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Input, Label, PageHeader, StatPanel, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, vEnter } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { formatDate } from '@/lib/format'
import { slugify } from '@/lib/slugify'

const router = useRouter()
const tenants = ref<TenantView[]>([])
const loadError = ref<string | null>(null)
const loaded = ref(false)

const activeCount = computed(() => tenants.value.filter((t) => t.status === 'active').length)
const suspendedCount = computed(() => tenants.value.length - activeCount.value)

const createOpen = ref(false)
const name = ref('')
const slug = ref('')
const slugEdited = ref(false)
const createError = ref<string | null>(null)
const creating = ref(false)

watch(name, (value) => {
  if (!slugEdited.value) slug.value = slugify(value)
})

function openCreate() {
  name.value = ''
  slug.value = ''
  slugEdited.value = false
  createError.value = null
  createOpen.value = true
}

async function create() {
  creating.value = true
  createError.value = null
  try {
    const tenant = await api.post<TenantView>('/admin/tenants', { name: name.value.trim(), slug: slug.value })
    createOpen.value = false
    await router.push(`/tenants/${tenant.id}`)
  } catch (e) {
    createError.value = e instanceof ApiError ? e.message : 'Could not create the tenant'
  } finally {
    creating.value = false
  }
}

onMounted(async () => {
  try {
    tenants.value = (await api.get<{ tenants: TenantView[] }>('/admin/tenants')).tenants
  } catch (e) {
    loadError.value = e instanceof ApiError ? e.message : 'Could not load tenants'
  } finally {
    loaded.value = true
  }
})
</script>

<template>
  <div class="grid gap-6">
    <PageHeader title="Tenants" description="Shops using helpix. Open one to manage its admins, widget key and allowed sites.">
      <template v-if="tenants.length > 0" #actions>
        <Button @click="openCreate">New tenant</Button>
      </template>
    </PageHeader>
    <p v-if="loadError" class="text-sm text-destructive" role="alert">{{ loadError }}</p>

    <div v-if="loaded && !loadError && tenants.length > 0" class="grid gap-4 sm:grid-cols-3">
      <StatPanel v-enter="0" label="Shops" :value="tenants.length" emphasis :caption="tenants.length === 1 ? 'shop using helpix' : 'shops using helpix'" />
      <StatPanel v-enter="1" label="Active" :value="activeCount" caption="widget and admin logins work" />
      <StatPanel v-enter="2" label="Suspended" :value="suspendedCount" :negative="suspendedCount > 0" caption="widget off, admins blocked" />
    </div>

    <Card v-if="loaded && !loadError" v-enter="3" class="gap-0 overflow-hidden py-0">
      <EmptyState
        v-if="tenants.length === 0"
        title="No tenants yet"
        description="A tenant is one shop. Create it, then add its admins and the sites where its widget may run."
      >
        <Button @click="openCreate">Create your first tenant</Button>
      </EmptyState>
      <div v-else class="relative overflow-x-auto overflow-y-hidden">
        <Table>
          <TableHeader>
            <TableRow class="hover:bg-transparent">
              <TableHead class="pl-6">Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead class="w-10 pr-6"><span class="sr-only">Open</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <!-- The name link stretches over the whole row, so rows are clickable and keyboard-reachable. -->
            <TableRow
              v-for="(t, i) in tenants"
              :key="t.id"
              v-enter="i + 4"
              class="group relative hover:bg-muted/50 focus-within:bg-muted/50"
            >
              <TableCell class="py-3 pl-6 font-medium">
                <RouterLink
                  :to="`/tenants/${t.id}`"
                  class="whitespace-nowrap after:absolute after:inset-0 focus-visible:outline-none"
                >{{ t.name }}</RouterLink>
              </TableCell>
              <TableCell class="font-mono text-xs text-muted-foreground">{{ t.slug }}</TableCell>
              <TableCell>
                <Badge :variant="t.status === 'active' ? 'positive' : 'negative'" dot>{{ t.status }}</Badge>
              </TableCell>
              <TableCell class="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{{ formatDate(t.createdAt) }}</TableCell>
              <TableCell class="pr-6 text-muted-foreground">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  class="size-4 transition-transform duration-150 ease-out group-hover:translate-x-0.5"
                ><path d="m9 18 6-6-6-6" /></svg>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </Card>

    <Dialog v-model:open="createOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New tenant</DialogTitle>
          <DialogDescription>A tenant is one shop. You can add its admins and allowed sites next.</DialogDescription>
        </DialogHeader>
        <form id="create-tenant" class="grid gap-4" @submit.prevent="create">
          <div class="grid gap-2">
            <Label for="tenant-name">Name</Label>
            <Input id="tenant-name" v-model="name" placeholder="e.g. iStore Saigon" required maxlength="100" />
          </div>
          <div class="grid gap-2">
            <Label for="tenant-slug">Slug</Label>
            <Input id="tenant-slug" v-model="slug" class="font-mono" placeholder="istore-saigon" required maxlength="50" @input="slugEdited = true" />
            <p class="text-xs text-muted-foreground">Lowercase letters, numbers and dashes.</p>
          </div>
          <p v-if="createError" class="text-sm text-destructive" role="alert">{{ createError }}</p>
        </form>
        <DialogFooter>
          <Button variant="outline" @click="createOpen = false">Cancel</Button>
          <Button type="submit" form="create-tenant" :disabled="creating || !slug">Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
