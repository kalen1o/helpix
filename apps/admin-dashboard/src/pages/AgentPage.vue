<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AgentConfig, AgentConfigState, ChatModelsResponse } from '@helpix/shared/api-types'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, vEnter } from '@helpix/ui'
import { ApiError } from '@/api/client'
import { api } from '@/auth/session'
import AgentSettingsForm from '@/components/agent/AgentSettingsForm.vue'
import PlaygroundPanel from '@/components/agent/PlaygroundPanel.vue'
import { configProblem, sameAgentConfig } from '@/lib/agent'

const state = ref<AgentConfigState | null>(null)
/** The config being edited; differs from state.draft until saved. */
const form = ref<AgentConfig | null>(null)
const models = ref<ChatModelsResponse | null>(null)
const pageError = ref<string | null>(null)
const actionError = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref<'save' | 'publish' | null>(null)

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback)
const dirty = computed(() => !!state.value && !!form.value && !sameAgentConfig(form.value, state.value.draft))
const live = computed(() => !!state.value?.published && !!form.value && sameAgentConfig(form.value, state.value.published))
const problem = computed(() => (form.value ? configProblem(form.value) : null))

async function load() {
  try {
    const [s, m] = await Promise.all([
      api.get<AgentConfigState>('/agent/config'),
      // Only the optional model picker needs this, so the page still works without it.
      api.get<ChatModelsResponse>('/chat/models').catch(() => null),
    ])
    state.value = s
    form.value = { ...s.draft }
    models.value = m
  } catch (e) {
    pageError.value = message(e, 'Could not load the agent settings')
  }
}

function adopt(s: AgentConfigState) {
  state.value = s
  form.value = { ...s.draft }
}

async function act(kind: 'save' | 'publish') {
  busy.value = kind
  actionError.value = null
  notice.value = null
  try {
    if (kind === 'save' || dirty.value) adopt(await api.put<AgentConfigState>('/agent/config/draft', form.value))
    if (kind === 'publish') {
      adopt(await api.post<AgentConfigState>('/agent/config/publish'))
      notice.value = "Published. Your shop's chat now uses these settings."
    } else {
      notice.value = 'Draft saved. Publish it when you are happy with it.'
    }
  } catch (e) {
    actionError.value = message(e, kind === 'publish' ? 'Could not publish' : 'Could not save the draft')
  } finally {
    busy.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="grid gap-6">
    <PageHeader title="Agent" description="How the assistant on your shop speaks, and what it is told to do.">
      <template v-if="form" #badge>
        <Badge v-if="dirty" variant="secondary">Unsaved changes</Badge>
        <Badge v-else-if="live" variant="positive" dot>Live</Badge>
        <Badge v-else variant="outline">Draft not published</Badge>
      </template>
      <template v-if="form" #actions>
        <Button variant="outline" :disabled="!dirty || !!problem || busy !== null" @click="act('save')">
          {{ busy === 'save' ? 'Saving…' : 'Save draft' }}
        </Button>
        <Button :disabled="(live && !dirty) || !!problem || busy !== null" @click="act('publish')">
          {{ busy === 'publish' ? 'Publishing…' : 'Publish' }}
        </Button>
      </template>
    </PageHeader>

    <p v-if="pageError" class="text-sm text-destructive" role="alert">{{ pageError }}</p>
    <p v-if="actionError" class="text-sm text-destructive" role="alert">{{ actionError }}</p>
    <p v-if="notice" class="text-sm text-muted-foreground" role="status">{{ notice }}</p>

    <div v-if="form" class="grid items-start gap-6 lg:grid-cols-2">
      <Card v-enter="0">
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Changes are saved as a draft. Publishing makes them live on your shop.</CardDescription>
        </CardHeader>
        <CardContent class="grid gap-4">
          <AgentSettingsForm v-model="form" :models="models" />
          <p v-if="problem" class="text-sm text-destructive" role="alert">{{ problem }}</p>
        </CardContent>
      </Card>
      <PlaygroundPanel v-enter="1" :config="form" :disabled="!!problem" />
    </div>
  </div>
</template>
