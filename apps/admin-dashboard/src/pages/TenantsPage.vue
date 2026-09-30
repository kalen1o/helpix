<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { TenantView } from '@helpix/shared/api-types'
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'

const tenants = ref<TenantView[]>([])
const loadError = ref<string | null>(null)

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
    <h1 class="text-2xl font-semibold">Tenants</h1>
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
        <TableRow v-for="t in tenants" :key="t.id">
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
  </div>
</template>
