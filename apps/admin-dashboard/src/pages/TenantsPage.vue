<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { TenantView } from '@helpix/shared/api-types'
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import { slugify } from '@/lib/slugify'

const router = useRouter()
const tenants = ref<TenantView[]>([])
const loadError = ref<string | null>(null)

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
  }
})
</script>

<template>
  <div class="grid gap-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Tenants</h1>
      <Button @click="openCreate">New tenant</Button>
    </div>
    <p v-if="loadError" class="text-sm text-destructive">{{ loadError }}</p>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Slug</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="t in tenants" :key="t.id" class="cursor-pointer" @click="router.push(`/tenants/${t.id}`)">
          <TableCell class="font-medium">{{ t.name }}</TableCell>
          <TableCell class="text-muted-foreground">{{ t.slug }}</TableCell>
          <TableCell>
            <Badge :variant="t.status === 'active' ? 'secondary' : 'destructive'">{{ t.status }}</Badge>
          </TableCell>
          <TableCell>{{ new Date(t.createdAt).toLocaleDateString() }}</TableCell>
        </TableRow>
        <TableRow v-if="tenants.length === 0 && !loadError">
          <TableCell colspan="4" class="text-center text-muted-foreground">No tenants yet.</TableCell>
        </TableRow>
      </TableBody>
    </Table>

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
