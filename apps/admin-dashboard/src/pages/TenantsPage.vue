<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { TenantView } from '@helpix/shared/api-types'
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { formatDate } from '@/lib/format'
import { slugify } from '@/lib/slugify'

const router = useRouter()
const tenants = ref<TenantView[]>([])
const loadError = ref<string | null>(null)
const loaded = ref(false)

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
    <div class="flex items-end justify-between gap-4">
      <div class="grid gap-1">
        <h1 class="text-2xl font-semibold">Tenants</h1>
        <p class="text-sm text-muted-foreground">
          {{ loaded && !loadError ? `${tenants.length} ${tenants.length === 1 ? 'shop' : 'shops'} using helpix` : 'Shops using helpix' }}
        </p>
      </div>
      <Button v-if="tenants.length > 0" @click="openCreate">New tenant</Button>
    </div>
    <p v-if="loadError" class="text-sm text-destructive" role="alert">{{ loadError }}</p>

    <Card v-if="loaded && !loadError" class="gap-0 overflow-hidden py-0">
      <EmptyState
        v-if="tenants.length === 0"
        title="No tenants yet"
        description="A tenant is one shop. Create it, then add its admins and the sites where its widget may run."
      >
        <Button @click="openCreate">Create your first tenant</Button>
      </EmptyState>
      <Table v-else>
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
            v-for="t in tenants"
            :key="t.id"
            class="group relative hover:bg-accent/60 focus-within:bg-accent/60"
          >
            <TableCell class="py-3 pl-6 font-medium">
              <RouterLink
                :to="`/tenants/${t.id}`"
                class="after:absolute after:inset-0 focus-visible:outline-none"
              >{{ t.name }}</RouterLink>
            </TableCell>
            <TableCell class="font-mono text-xs text-muted-foreground">{{ t.slug }}</TableCell>
            <TableCell>
              <Badge :variant="t.status === 'active' ? 'positive' : 'negative'" dot>{{ t.status }}</Badge>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ formatDate(t.createdAt) }}</TableCell>
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
            <Input id="tenant-name" v-model="name" required maxlength="100" />
          </div>
          <div class="grid gap-2">
            <Label for="tenant-slug">Slug</Label>
            <Input id="tenant-slug" v-model="slug" required maxlength="50" @input="slugEdited = true" />
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
