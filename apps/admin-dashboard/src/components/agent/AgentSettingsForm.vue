<script setup lang="ts">
import type { AgentConfig, ChatModelsResponse } from '@helpix/shared/api-types'
import { Input, Label, Textarea } from '@helpix/ui'
import { AGENT_PROMPT_MAX, GREETING_MAX, TONE_NOTES_MAX, TONE_OPTIONS } from '@/lib/agent'

defineProps<{ models: ChatModelsResponse | null }>()
const config = defineModel<AgentConfig>({ required: true })

function set<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
  config.value = { ...config.value, [key]: value }
}

// Matches @helpix/ui's Input, for the native select.
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
</script>

<template>
  <div class="grid gap-6">
    <div class="grid gap-2">
      <div class="flex items-baseline justify-between gap-3">
        <Label for="agent-prompt">Instructions</Label>
        <span class="text-xs tabular-nums" :class="config.prompt.length > AGENT_PROMPT_MAX ? 'text-destructive' : 'text-muted-foreground'">
          {{ config.prompt.length.toLocaleString('en-US') }} / {{ AGENT_PROMPT_MAX.toLocaleString('en-US') }}
        </span>
      </div>
      <Textarea
        id="agent-prompt"
        :model-value="config.prompt"
        class="min-h-48 leading-relaxed"
        placeholder="Who the agent speaks for, what it can promise and what it should always mention. For example: We sell refurbished iPhones with a 12-month warranty. Always mention free returns within 30 days."
        @update:model-value="set('prompt', $event)"
      />
      <p class="text-xs text-muted-foreground">
        Helpix's platform rules always come first: the agent stays on your shop's topics, answers from your knowledge base and never
        invents order details.
      </p>
    </div>

    <fieldset class="grid gap-2">
      <legend class="mb-2 text-sm font-medium leading-none">Tone</legend>
      <div class="grid gap-2 sm:grid-cols-2">
        <label
          v-for="t in TONE_OPTIONS"
          :key="t.value"
          class="flex cursor-pointer gap-3 rounded-md border p-3 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
        >
          <input
            type="radio"
            name="agent-tone"
            class="mt-0.5 accent-primary"
            :value="t.value"
            :checked="config.tone === t.value"
            @change="set('tone', t.value)"
          />
          <span class="grid gap-0.5">
            <span class="font-medium">{{ t.label }}</span>
            <span class="text-xs text-muted-foreground">{{ t.hint }}</span>
          </span>
        </label>
      </div>
    </fieldset>

    <div class="grid gap-2">
      <Label for="agent-tone-notes">Tone notes <span class="font-normal text-muted-foreground">(optional)</span></Label>
      <Input
        id="agent-tone-notes"
        :model-value="config.toneNotes"
        :maxlength="TONE_NOTES_MAX"
        placeholder='For example: call customers "bestie", no exclamation marks.'
        @update:model-value="set('toneNotes', $event)"
      />
    </div>

    <div class="grid gap-4 sm:grid-cols-[1fr_auto]">
      <div class="grid gap-2">
        <Label for="agent-greeting">Greeting</Label>
        <Input id="agent-greeting" :model-value="config.greeting" :maxlength="GREETING_MAX" @update:model-value="set('greeting', $event)" />
      </div>
      <div class="grid gap-2">
        <Label for="agent-accent">Accent colour</Label>
        <div class="flex items-center gap-2">
          <input
            type="color"
            aria-label="Pick the accent colour"
            class="h-9 w-10 cursor-pointer rounded-md border border-input bg-transparent p-1"
            :value="config.accentColor"
            @input="set('accentColor', ($event.target as HTMLInputElement).value.toUpperCase())"
          />
          <Input
            id="agent-accent"
            :model-value="config.accentColor"
            class="w-28 font-mono uppercase"
            maxlength="7"
            @update:model-value="set('accentColor', $event)"
          />
        </div>
      </div>
    </div>
    <p class="-mt-4 text-xs text-muted-foreground">The chat widget on your shop shows the greeting and uses the colour.</p>

    <div v-if="models && models.overrides.length > 0" class="grid gap-2">
      <Label for="agent-model">Model</Label>
      <select
        id="agent-model"
        :class="SELECT_CLASS"
        :value="config.modelOverride ?? ''"
        @change="set('modelOverride', ($event.target as HTMLSelectElement).value || null)"
      >
        <option value="">Platform default ({{ models.defaultModel }})</option>
        <option v-for="m in models.overrides" :key="m" :value="m">{{ m }}</option>
      </select>
    </div>
  </div>
</template>
