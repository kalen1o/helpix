<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { AdminView, TenantView } from '@helpix/shared/api-types'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, CopyButton, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { formatDate } from '@/lib/format'
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

const originsText = ref('')
const originsError = ref<string | null>(null)
const originsSaved = ref(false)
const savingOrigins = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | undefined
// Save is only useful when the text differs from what the server last returned.
const originsDirty = computed(() => originsText.value !== (tenant.value?.allowedOrigins.join('\n') ?? ''))

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

async function saveOrigins() {
  originsError.value = null
  originsSaved.value = false
  clearTimeout(savedTimer)
  savingOrigins.value = true
  try {
    setTenant(await api.patch<TenantView>(base.value, { allowedOrigins: parseOriginsInput(originsText.value) }))
    originsSaved.value = true
    savedTimer = setTimeout(() => (originsSaved.value = false), 2000)
  } catch (e) {
    originsError.value = message(e, 'Could not save allowed sites')
  } finally {
    savingOrigins.value = false
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
onBeforeUnmount(() => clearTimeout(savedTimer))
</script>

<template>
  <p v-if="pageError" class="text-sm text-destructive">{{ pageError }}</p>
  <div v-else-if="tenant" class="grid gap-6">
    <div class="grid gap-3">
      <RouterLink
        to="/tenants"
        class="inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="size-4"><path d="m15 18-6-6 6-6" /></svg>
        Tenants
      </RouterLink>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="grid gap-1">
          <h1 class="flex items-center gap-3 text-2xl font-semibold">
            {{ tenant.name }}
            <Badge :variant="tenant.status === 'active' ? 'positive' : 'negative'" dot>{{ tenant.status }}</Badge>
          </h1>
          <p class="font-mono text-xs text-muted-foreground">{{ tenant.slug }}</p>
        </div>
        <!-- The riskiest action stays quiet here; the confirm dialog carries the weight. -->
        <Button :variant="tenant.status === 'active' ? 'destructive-outline' : 'default'" @click="statusDialogOpen = true">
          {{ tenant.status === 'active' ? 'Suspend' : 'Reactivate' }}
        </Button>
      </div>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Widget key</CardTitle>
        <CardDescription>The shop puts this key in its widget script tag. It is public.</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-wrap items-center gap-2">
        <code class="inline-flex h-8 select-all items-center rounded-md border bg-muted px-3 font-mono text-xs">{{ tenant.widgetKey }}</code>
        <CopyButton :value="tenant.widgetKey" />
        <Button variant="outline" size="sm" @click="rotateDialogOpen = true">Rotate</Button>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Allowed sites</CardTitle>
        <CardDescription>Origins where the widget may run, one per line, e.g. https://shop.example</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-3">
        <Textarea v-model="originsText" rows="4" class="font-mono text-xs" placeholder="https://shop.example" @input="originsSaved = false" />
        <div class="flex items-center gap-3">
          <Button size="sm" :disabled="!originsDirty || savingOrigins" @click="saveOrigins">Save</Button>
          <Transition
            enter-active-class="transition-opacity duration-150 ease-out"
            leave-active-class="transition-opacity duration-300 ease-out"
            enter-from-class="opacity-0"
            leave-to-class="opacity-0"
          >
            <span v-if="originsSaved" class="text-sm text-muted-foreground">Saved</span>
          </Transition>
          <span v-if="originsError" class="text-sm text-destructive" role="alert">{{ originsError }}</span>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Admins</CardTitle>
        <CardDescription>People who manage this shop's knowledge base and agent.</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-6">
        <Table v-if="admins.length > 0">
          <TableHeader>
            <TableRow class="hover:bg-transparent">
              <TableHead>Email</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="a in admins" :key="a.id">
              <TableCell class="py-3">{{ a.email }}</TableCell>
              <TableCell class="text-muted-foreground">{{ formatDate(a.createdAt) }}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p v-else class="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No admins yet. Add one below so the shop can sign in.
        </p>

        <div class="grid gap-3 border-t pt-5">
          <h3 class="text-sm font-medium">Add an admin</h3>
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
        </div>
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
