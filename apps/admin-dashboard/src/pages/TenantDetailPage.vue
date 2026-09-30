<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { AdminView, TenantView } from '@helpix/shared/api-types'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { parseOriginsInput } from '@/lib/origins'

const route = useRoute()
const id = computed(() => String(route.params.id))
const base = computed(() => `/admin/tenants/${id.value}`)

const tenant = ref<TenantView | null>(null)
const admins = ref<AdminView[]>([])
const pageError = ref<string | null>(null)

const statusDialogOpen = ref(false)
const rotateDialogOpen = ref(false)
const busy = ref(false)
const actionError = ref<string | null>(null)
const copied = ref(false)

const originsText = ref('')
const originsError = ref<string | null>(null)
const originsSaved = ref(false)

const newAdminEmail = ref('')
const newAdminPassword = ref('')
const adminError = ref<string | null>(null)

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback
}

function setTenant(t: TenantView) {
  tenant.value = t
  originsText.value = t.allowedOrigins.join('\n')
}

async function load() {
  try {
    const [t, a] = await Promise.all([
      api.get<TenantView>(base.value),
      api.get<{ admins: AdminView[] }>(`${base.value}/admins`),
    ])
    setTenant(t)
    admins.value = a.admins
  } catch (e) {
    pageError.value = message(e, 'Could not load the tenant')
  }
}

async function runAction(path: string, close: () => void) {
  busy.value = true
  actionError.value = null
  try {
    setTenant(await api.post<TenantView>(`${base.value}${path}`))
    close()
  } catch (e) {
    actionError.value = message(e, 'The action failed')
  } finally {
    busy.value = false
  }
}

// A stale failure from an earlier attempt must not greet the next dialog.
watch([statusDialogOpen, rotateDialogOpen], ([status, rotate]) => {
  if (status || rotate) actionError.value = null
})

const toggleStatus = () =>
  runAction(tenant.value?.status === 'active' ? '/suspend' : '/reactivate', () => (statusDialogOpen.value = false))
const rotateKey = () => runAction('/widget-key/rotate', () => (rotateDialogOpen.value = false))

async function copyKey() {
  if (!tenant.value) return
  await navigator.clipboard.writeText(tenant.value.widgetKey)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

async function saveOrigins() {
  originsError.value = null
  originsSaved.value = false
  try {
    setTenant(await api.patch<TenantView>(base.value, { allowedOrigins: parseOriginsInput(originsText.value) }))
    originsSaved.value = true
  } catch (e) {
    originsError.value = message(e, 'Could not save allowed sites')
  }
}

async function createAdmin() {
  adminError.value = null
  try {
    const admin = await api.post<AdminView>(`${base.value}/admins`, {
      email: newAdminEmail.value,
      password: newAdminPassword.value,
    })
    admins.value.push(admin)
    newAdminEmail.value = ''
    newAdminPassword.value = ''
  } catch (e) {
    adminError.value = message(e, 'Could not create the admin')
  }
}

onMounted(load)
</script>

<template>
  <p v-if="pageError" class="text-sm text-destructive">{{ pageError }}</p>
  <div v-else-if="tenant" class="grid gap-6">
    <div class="flex items-center justify-between gap-4">
      <div>
        <RouterLink to="/tenants" class="text-sm text-muted-foreground hover:underline">← Tenants</RouterLink>
        <h1 class="flex items-center gap-3 text-2xl font-semibold">
          {{ tenant.name }}
          <Badge :variant="tenant.status === 'active' ? 'secondary' : 'destructive'">{{ tenant.status }}</Badge>
        </h1>
        <p class="text-sm text-muted-foreground">{{ tenant.slug }}</p>
      </div>
      <Button :variant="tenant.status === 'active' ? 'destructive' : 'default'" @click="statusDialogOpen = true">
        {{ tenant.status === 'active' ? 'Suspend' : 'Reactivate' }}
      </Button>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Widget key</CardTitle>
        <CardDescription>The shop puts this key in its widget script tag. It is public.</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-wrap items-center gap-3">
        <code class="rounded bg-muted px-2 py-1 text-sm">{{ tenant.widgetKey }}</code>
        <Button variant="outline" size="sm" @click="copyKey">{{ copied ? 'Copied' : 'Copy' }}</Button>
        <Button variant="outline" size="sm" @click="rotateDialogOpen = true">Rotate</Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Allowed sites</CardTitle>
        <CardDescription>Origins where the widget may run, one per line, e.g. https://shop.example</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-3">
        <Textarea v-model="originsText" rows="4" @input="originsSaved = false" />
        <div class="flex items-center gap-3">
          <Button size="sm" @click="saveOrigins">Save</Button>
          <span v-if="originsSaved" class="text-sm text-muted-foreground">Saved</span>
          <span v-if="originsError" class="text-sm text-destructive" role="alert">{{ originsError }}</span>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Admins</CardTitle>
        <CardDescription>People who manage this shop's knowledge base and agent.</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="a in admins" :key="a.id">
              <TableCell>{{ a.email }}</TableCell>
              <TableCell>{{ new Date(a.createdAt).toLocaleDateString() }}</TableCell>
            </TableRow>
            <TableRow v-if="admins.length === 0">
              <TableCell colspan="2" class="text-center text-muted-foreground">No admins yet.</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <form class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" @submit.prevent="createAdmin">
          <div class="grid gap-2">
            <Label for="admin-email">Email</Label>
            <Input id="admin-email" v-model="newAdminEmail" type="email" required />
          </div>
          <div class="grid gap-2">
            <Label for="admin-password">Temporary password</Label>
            <Input id="admin-password" v-model="newAdminPassword" type="password" minlength="8" required />
          </div>
          <Button type="submit">Add admin</Button>
        </form>
        <p v-if="adminError" class="text-sm text-destructive" role="alert">{{ adminError }}</p>
      </CardContent>
    </Card>

    <ConfirmDialog
      v-model:open="statusDialogOpen"
      :title="tenant.status === 'active' ? `Suspend ${tenant.name}?` : `Reactivate ${tenant.name}?`"
      :description="tenant.status === 'active'
        ? 'The widget stops working on their site and their admins cannot log in. No data is deleted.'
        : 'The widget and admin logins start working again.'"
      :confirm-label="tenant.status === 'active' ? 'Suspend' : 'Reactivate'"
      :destructive="tenant.status === 'active'"
      :busy="busy"
      :error="actionError"
      @confirm="toggleStatus"
    />
    <ConfirmDialog
      v-model:open="rotateDialogOpen"
      title="Rotate the widget key?"
      description="The current key stops working immediately. The shop must update its script tag with the new key."
      confirm-label="Rotate key"
      destructive
      :busy="busy"
      :error="actionError"
      @confirm="rotateKey"
    />
  </div>
</template>
