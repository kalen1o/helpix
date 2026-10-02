<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { IntegrationsView, OrderApiTestResult } from '@helpix/shared/api-types'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, InsetPanel, Label, MonoLabel, PageHeader, Textarea, vEnter } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { formatDate } from '@/lib/format'
import { apiKeyProblem, baseUrlProblem, HOST_CHANGED_KEY_PROBLEM, hostChanged, PUBLIC_KEY_MAX, publicKeyProblem, TEST_CUSTOMER_MAX, TEST_HEADLINE } from '@/lib/integrations'

const view = ref<IntegrationsView | null>(null)
const pageError = ref<string | null>(null)
const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)

// ── Order API ───────────────────────────────────────────────────────────────
const baseUrl = ref('')
/** Write-only: never filled from the server, cleared after every save. */
const apiKey = ref('')
const replacingKey = ref(false)
const orderBusy = ref<'save' | 'test' | null>(null)
const orderError = ref<string | null>(null)
const orderNotice = ref<string | null>(null)
const testCustomer = ref('')
const testResult = ref<OrderApiTestResult | null>(null)

const keySaved = computed(() => !!view.value?.orderApi?.hasApiKey)
// The stored key only goes to the host it was entered for, so a new host needs the key again.
const newHost = computed(() => keySaved.value && hostChanged(view.value?.orderApi?.baseUrl, baseUrl.value))
const showKeyInput = computed(() => !keySaved.value || newHost.value || replacingKey.value)
const orderDirty = computed(() => baseUrl.value.trim() !== (view.value?.orderApi?.baseUrl ?? '') || apiKey.value !== '')
const orderProblem = computed(
  () =>
    baseUrlProblem(baseUrl.value) ??
    (newHost.value && !apiKey.value ? HOST_CHANGED_KEY_PROBLEM : null) ??
    (showKeyInput.value ? apiKeyProblem(apiKey.value, !keySaved.value) : null),
)

function resetOrderForm() {
  baseUrl.value = view.value?.orderApi?.baseUrl ?? ''
  apiKey.value = ''
  replacingKey.value = false
}

function keepCurrentKey() {
  apiKey.value = ''
  replacingKey.value = false
}

async function saveOrderApi() {
  if (!orderDirty.value || orderProblem.value || orderBusy.value) return
  orderBusy.value = 'save'
  orderError.value = null
  orderNotice.value = null
  try {
    const body: { baseUrl: string; apiKey?: string } = { baseUrl: baseUrl.value.trim() }
    // Leaving the key out keeps the stored one.
    if (showKeyInput.value && apiKey.value) body.apiKey = apiKey.value
    view.value = await api.put<IntegrationsView>('/integrations/order-api', body)
    resetOrderForm()
    testResult.value = null
    orderNotice.value = 'Saved. Use "Test connection" to check it with a real customer.'
  } catch (e) {
    orderError.value = message(e, 'Could not save the order API')
  } finally {
    orderBusy.value = null
  }
}

async function testConnection() {
  const customerId = testCustomer.value.trim()
  if (!customerId || orderBusy.value) return
  orderBusy.value = 'test'
  orderError.value = null
  orderNotice.value = null
  testResult.value = null
  try {
    testResult.value = await api.post<OrderApiTestResult>('/integrations/order-api/test', { customerId })
  } catch (e) {
    orderError.value = message(e, 'Could not run the test')
  } finally {
    orderBusy.value = null
  }
}

// ── Shop sign-in key ────────────────────────────────────────────────────────
const pem = ref('')
const replacingPem = ref(false)
const keyBusy = ref(false)
const keyError = ref<string | null>(null)
const showPemInput = computed(() => !view.value?.shopKey || replacingPem.value)
const pemProblem = computed(() => publicKeyProblem(pem.value))

async function onPemFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  keyError.value = null
  if (file.size > PUBLIC_KEY_MAX) {
    keyError.value = 'That file is too large for a public key (10 KB at most).'
    return
  }
  pem.value = await file.text()
}

function cancelReplacePem() {
  pem.value = ''
  keyError.value = null
  replacingPem.value = false
}

async function saveShopKey() {
  if (pemProblem.value || keyBusy.value) return
  keyBusy.value = true
  keyError.value = null
  try {
    view.value = await api.put<IntegrationsView>('/integrations/shop-key', { publicKeyPem: pem.value.trim() })
    pem.value = ''
    replacingPem.value = false
  } catch (e) {
    keyError.value = message(e, 'Could not save the key')
  } finally {
    keyBusy.value = false
  }
}

// ── Removal ─────────────────────────────────────────────────────────────────
const removeOrderOpen = ref(false)
const removeKeyOpen = ref(false)
const removeBusy = ref(false)
const removeError = ref<string | null>(null)
// A stale failure from an earlier attempt must not greet the next dialog.
watch([removeOrderOpen, removeKeyOpen], ([a, b]) => {
  if (a || b) removeError.value = null
})

async function remove(kind: 'order-api' | 'shop-key') {
  removeBusy.value = true
  removeError.value = null
  try {
    await api.del(`/integrations/${kind}`)
    if (view.value && kind === 'order-api') {
      view.value = { ...view.value, orderApi: null }
      resetOrderForm()
      testResult.value = null
      orderNotice.value = null
      removeOrderOpen.value = false
    } else if (view.value) {
      view.value = { ...view.value, shopKey: null }
      cancelReplacePem()
      removeKeyOpen.value = false
    }
  } catch (e) {
    removeError.value = message(e, 'Could not remove it')
  } finally {
    removeBusy.value = false
  }
}

onMounted(async () => {
  try {
    view.value = await api.get<IntegrationsView>('/integrations')
    resetOrderForm()
  } catch (e) {
    pageError.value = message(e, 'Could not load the integrations')
  }
})
</script>

<template>
  <div class="grid gap-6">
    <PageHeader title="Integrations" description="Connect your shop so the assistant can look up orders for signed-in shoppers." />

    <p v-if="pageError" class="text-sm text-destructive" role="alert">{{ pageError }}</p>

    <div v-if="view" class="grid items-start gap-6 lg:grid-cols-2">
      <Card v-enter="0" data-card="order-api">
        <CardHeader>
          <div class="flex flex-wrap items-center gap-2">
            <CardTitle>Order API</CardTitle>
            <Badge v-if="view.orderApi" variant="positive" dot>Connected</Badge>
            <Badge v-else variant="outline">Not connected</Badge>
          </div>
          <CardDescription>
            Where Helpix asks your shop about a signed-in shopper's orders. Helpix calls
            <code class="font-mono text-xs">GET /orders</code> and <code class="font-mono text-xs">GET /orders/{id}</code> under this URL.
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-5">
          <form id="order-api-form" class="grid gap-4" @submit.prevent="saveOrderApi">
            <div class="grid gap-2">
              <Label for="integrations-base-url">Base URL</Label>
              <Input id="integrations-base-url" v-model="baseUrl" type="url" inputmode="url" maxlength="500" class="font-mono" placeholder="https://shop.example/api" />
            </div>
            <div v-if="showKeyInput" class="grid gap-2">
              <Label for="integrations-api-key">API key</Label>
              <Input
                id="integrations-api-key"
                v-model="apiKey"
                type="password"
                autocomplete="off"
                maxlength="500"
                class="font-mono"
                :placeholder="keySaved ? 'The new key' : 'The key your shop issued for Helpix'"
              />
              <p class="text-xs text-muted-foreground">Stored encrypted. Helpix never shows it again.</p>
            </div>
            <div v-else class="grid gap-2">
              <span class="text-sm font-medium">API key</span>
              <p class="flex items-center gap-1.5 text-sm">
                <span>Key saved</span>
                <span aria-hidden="true" class="text-muted-foreground">·</span>
                <button
                  type="button"
                  class="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  @click="replacingKey = true"
                >Replace</button>
              </p>
            </div>
            <p v-if="orderDirty && orderProblem" class="text-sm text-destructive" role="alert">{{ orderProblem }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="secondary" :disabled="!orderDirty || !!orderProblem || orderBusy !== null">
                {{ orderBusy === 'save' ? 'Saving…' : 'Save' }}
              </Button>
              <Button v-if="replacingKey" variant="ghost" @click="keepCurrentKey">Keep current key</Button>
              <Button v-if="view.orderApi" variant="destructive-outline" class="ml-auto" @click="removeOrderOpen = true">Remove</Button>
            </div>
          </form>

          <InsetPanel v-if="view.orderApi" class="grid gap-3">
            <MonoLabel>Test connection</MonoLabel>
            <form id="order-test-form" class="flex flex-wrap items-end gap-2" @submit.prevent="testConnection">
              <div class="grid min-w-48 flex-1 gap-2">
                <Label for="integrations-test-customer">Customer ID</Label>
                <Input id="integrations-test-customer" v-model="testCustomer" :maxlength="TEST_CUSTOMER_MAX" class="font-mono" placeholder="cust_1001" />
              </div>
              <Button type="submit" variant="outline" :disabled="!testCustomer.trim() || orderBusy !== null">
                {{ orderBusy === 'test' ? 'Testing…' : 'Test connection' }}
              </Button>
            </form>
            <p class="text-xs text-muted-foreground">Uses the saved settings and asks your shop for this customer's latest order.</p>
            <div v-if="testResult" data-test-result role="status" class="grid gap-0.5 text-sm">
              <span data-headline class="font-medium" :class="testResult.ok ? 'text-primary' : 'text-destructive'">{{ TEST_HEADLINE[testResult.status] }}</span>
              <span class="text-muted-foreground">{{ testResult.message }}</span>
            </div>
          </InsetPanel>

          <p v-if="orderError" class="text-sm text-destructive" role="alert">{{ orderError }}</p>
          <p v-if="orderNotice" class="text-sm text-muted-foreground" role="status">{{ orderNotice }}</p>
        </CardContent>
      </Card>

      <Card v-enter="1" data-card="shop-key">
        <CardHeader>
          <div class="flex flex-wrap items-center gap-2">
            <CardTitle>Shop sign-in key</CardTitle>
            <Badge v-if="view.shopKey" variant="positive" dot>Added</Badge>
            <Badge v-else variant="outline">Not added</Badge>
          </div>
          <CardDescription>
            Lets your shop tell Helpix who is signed in. Your shop keeps the private key and signs a short token for each
            shopper. Helpix only needs the public key.
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-5">
          <template v-if="!showPemInput && view.shopKey">
            <InsetPanel class="grid gap-2">
              <MonoLabel>Fingerprint (SHA-256)</MonoLabel>
              <span class="font-mono text-xs [overflow-wrap:anywhere]">{{ view.shopKey.fingerprint }}</span>
              <span class="text-xs text-muted-foreground">Added <span class="font-mono tabular-nums">{{ formatDate(view.shopKey.updatedAt) }}</span></span>
            </InsetPanel>
            <div class="flex flex-wrap gap-2">
              <Button variant="outline" @click="replacingPem = true">Replace</Button>
              <Button variant="destructive-outline" class="ml-auto" @click="removeKeyOpen = true">Remove</Button>
            </div>
          </template>

          <form v-else id="shop-key-form" class="grid gap-4" @submit.prevent="saveShopKey">
            <div class="grid gap-2">
              <Label for="integrations-pem">Public key (PEM)</Label>
              <Textarea id="integrations-pem" v-model="pem" rows="7" class="font-mono text-xs" placeholder="-----BEGIN PUBLIC KEY-----" />
            </div>
            <div class="grid gap-2">
              <Label for="integrations-pem-file">Or upload a .pem file</Label>
              <input
                id="integrations-pem-file"
                type="file"
                accept=".pem,.pub,.txt"
                class="text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
                @change="onPemFile"
              />
            </div>
            <p v-if="pem.trim() && pemProblem" class="text-sm text-destructive" role="alert">{{ pemProblem }}</p>
            <div class="flex flex-wrap gap-2">
              <Button type="submit" variant="secondary" :disabled="!!pemProblem || keyBusy">{{ keyBusy ? 'Saving…' : 'Save key' }}</Button>
              <Button v-if="replacingPem" variant="ghost" @click="cancelReplacePem">Cancel</Button>
            </div>
          </form>

          <p v-if="keyError" class="text-sm text-destructive" role="alert">{{ keyError }}</p>

          <InsetPanel class="grid gap-1.5 text-xs text-muted-foreground">
            <MonoLabel>The token your shop signs</MonoLabel>
            <span>RS256, signed with the private key that matches this public key.</span>
            <span><code class="font-mono text-foreground">sub</code>: the shopper's customer ID</span>
            <span><code class="font-mono text-foreground">aud</code>: your widget key</span>
            <span><code class="font-mono text-foreground">exp</code>: at most 1 hour after <code class="font-mono text-foreground">iat</code></span>
            <span>
              Your page passes it to <code class="font-mono text-foreground">Helpix.identify(token)</code> and calls
              <code class="font-mono text-foreground">Helpix.logout()</code> on sign-out.
            </span>
          </InsetPanel>
        </CardContent>
      </Card>
    </div>

    <ConfirmDialog
      v-model:open="removeOrderOpen"
      title="Remove the order API?"
      description="The assistant stops looking up orders right away, and the saved API key is deleted."
      confirm-label="Remove order API"
      destructive
      :busy="removeBusy"
      :error="removeError"
      @confirm="remove('order-api')"
    />
    <ConfirmDialog
      v-model:open="removeKeyOpen"
      title="Remove the shop sign-in key?"
      description="Shoppers can no longer be signed in to the chat, so it can't look up their orders. Chat keeps working for everyone as a guest."
      confirm-label="Remove key"
      destructive
      :busy="removeBusy"
      :error="removeError"
      @confirm="remove('shop-key')"
    />
  </div>
</template>
