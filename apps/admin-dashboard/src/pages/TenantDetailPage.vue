<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { AdminView, TenantView } from '@helpix/shared/api-types'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, CopyButton, Input, Label, PageHeader, StatPanel, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea, vEnter } from '@helpix/ui'
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
    <PageHeader :title="tenant.name">
      <template #eyebrow>
        <RouterLink
          to="/tenants"
          class="mb-2 inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="size-4"><path d="m15 18-6-6 6-6" /></svg>
          Tenants
        </RouterLink>
      </template>
      <template #badge>
        <Badge :variant="tenant.status === 'active' ? 'positive' : 'negative'" dot>{{ tenant.status }}</Badge>
      </template>
      <template #description>
        <span class="font-mono text-xs">{{ tenant.slug }}</span>
      </template>
      <template #actions>
        <!-- The riskiest action stays quiet here; the confirm dialog carries the weight. -->
        <Button :variant="tenant.status === 'active' ? 'destructive-outline' : 'default'" @click="statusDialogOpen = true">
          {{ tenant.status === 'active' ? 'Suspend' : 'Reactivate' }}
        </Button>
      </template>
    </PageHeader>

    <div class="grid gap-4 sm:grid-cols-3">
      <StatPanel
        v-enter="0"
        label="Status"
        :value="tenant.status === 'active' ? 'Active' : 'Suspended'"
        :negative="tenant.status !== 'active'"
        :caption="tenant.status === 'active' ? 'widget and admin logins work' : 'widget off, admins blocked, no data deleted'"
      />
      <StatPanel v-enter="1" label="Admins" :value="admins.length" :caption="admins.length === 0 ? 'nobody can sign in yet' : 'can sign in to this shop'" />
      <StatPanel
        v-enter="2"
        label="Allowed sites"
        :value="tenant.allowedOrigins.length"
        :caption="tenant.allowedOrigins.length === 0 ? 'the widget runs nowhere yet' : 'where the widget may run'"
      />
    </div>

    <Card v-enter="3">
      <CardHeader>
        <CardTitle>Widget key</CardTitle>
        <CardDescription>The shop puts this key in its widget script tag. It is public.</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-wrap items-center gap-2">
        <code class="inline-flex h-8 min-w-0 max-w-full select-all items-center truncate rounded-md border bg-muted px-3 font-mono text-xs">{{ tenant.widgetKey }}</code>
        <CopyButton :value="tenant.widgetKey" />
        <Button variant="outline" size="sm" @click="rotateDialogOpen = true">Rotate</Button>
      </CardContent>
    </Card>

    <div class="grid items-start gap-6 lg:grid-cols-2">
      <Card v-enter="4">
        <CardHeader>
          <CardTitle>Allowed sites</CardTitle>
          <CardDescription>Origins where the widget may run, one per line, e.g. https://shop.example</CardDescription>
        </CardHeader>
        <CardContent class="grid gap-3">
          <Textarea v-model="originsText" rows="5" class="font-mono text-xs" placeholder="https://shop.example&#10;http://localhost:5174" @input="originsSaved = false" />
          <div class="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="secondary" :disabled="!originsDirty || savingOrigins" @click="saveOrigins">Save</Button>
            <Transition
              enter-active-class="transition-opacity duration-150 ease-out"
              leave-active-class="transition-opacity duration-300 ease-out"
              enter-from-class="opacity-0"
              leave-to-class="opacity-0"
            >
              <span v-if="originsSaved" class="text-sm text-muted-foreground" role="status">Saved</span>
            </Transition>
            <span v-if="originsError" class="text-sm text-destructive" role="alert">{{ originsError }}</span>
          </div>
        </CardContent>
      </Card>

      <Card v-enter="5">
        <CardHeader>
          <CardTitle>Admins</CardTitle>
          <CardDescription>People who manage this shop's knowledge base and agent.</CardDescription>
        </CardHeader>
        <CardContent class="grid gap-5">
          <div v-if="admins.length > 0" class="relative overflow-x-auto overflow-y-hidden">
            <Table>
              <TableHeader>
                <TableRow class="hover:bg-transparent">
                  <TableHead>Email</TableHead>
                  <TableHead>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="a in admins" :key="a.id">
                  <TableCell class="py-3 [overflow-wrap:anywhere]">{{ a.email }}</TableCell>
                  <TableCell class="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{{ formatDate(a.createdAt) }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p v-else class="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No admins yet. Add one below so the shop can sign in.
          </p>

          <form class="grid gap-3 rounded-lg border bg-muted/50 p-4" @submit.prevent="createAdmin">
            <h3 class="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Add an admin</h3>
            <div class="grid gap-2">
              <Label for="admin-email">Email</Label>
              <Input id="admin-email" v-model="newAdminEmail" type="email" placeholder="owner@shop.com" required />
            </div>
            <div class="grid gap-2">
              <Label for="admin-password">Temporary password</Label>
              <Input id="admin-password" v-model="newAdminPassword" type="password" minlength="8" autocomplete="new-password" placeholder="At least 8 characters" required />
            </div>
            <p v-if="adminError" class="text-sm text-destructive" role="alert">{{ adminError }}</p>
            <Button type="submit" variant="secondary" class="justify-self-end">Add admin</Button>
          </form>
        </CardContent>
      </Card>
    </div>

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
