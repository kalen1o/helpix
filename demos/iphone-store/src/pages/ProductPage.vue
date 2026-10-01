<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { addToBag } from '../cart'
import PhoneArt from '../components/PhoneArt.vue'
import { formatPrice, productById } from '../products'

const props = defineProps<{ id: string }>()
const product = computed(() => productById(props.id))
const color = ref(0)
const storage = ref(0)
const added = ref(false)
watch(() => props.id, () => { color.value = 0; storage.value = 0; added.value = false })

function add() {
  const p = product.value!
  addToBag(p.id, p.colors[color.value]!.name, p.storage[storage.value]!.gb)
  added.value = true
}
</script>

<template>
  <p v-if="!product" class="text-muted-foreground">That product doesn’t exist. <RouterLink to="/" class="underline">Back to phones</RouterLink></p>
  <div v-else class="grid gap-10 md:grid-cols-2">
    <div class="rounded-xl bg-card ring-1 ring-border">
      <PhoneArt size="lg" :body="product.colors[color]!.body" :accent="product.colors[color]!.accent" :kind="product.kind" />
    </div>
    <div>
      <h1 class="font-display text-4xl font-semibold tracking-tight">{{ product.name }}</h1>
      <p class="mt-3 text-muted-foreground">{{ product.description }}</p>
      <fieldset class="mt-8">
        <legend class="text-sm font-medium">Colour: {{ product.colors[color]!.name }}</legend>
        <div class="mt-3 flex gap-3">
          <button
            v-for="(c, i) in product.colors"
            :key="c.name"
            type="button"
            :aria-label="c.name"
            :aria-pressed="i === color"
            class="size-9 rounded-full ring-2 ring-offset-2 ring-offset-background"
            :class="i === color ? 'ring-foreground' : 'ring-transparent'"
            :style="{ background: c.body }"
            @click="color = i"
          />
        </div>
      </fieldset>
      <fieldset v-if="product.kind === 'phone'" class="mt-6">
        <legend class="text-sm font-medium">Storage</legend>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="(s, i) in product.storage"
            :key="s.gb"
            type="button"
            :aria-pressed="i === storage"
            class="rounded-lg px-4 py-2 text-sm ring-1"
            :class="i === storage ? 'ring-foreground' : 'ring-border text-muted-foreground'"
            @click="storage = i"
          >
            {{ s.gb >= 1024 ? `${s.gb / 1024} TB` : `${s.gb} GB` }} · {{ formatPrice(s.priceCents) }}
          </button>
        </div>
      </fieldset>
      <button type="button" class="mt-8 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground" @click="add">
        Add to bag · {{ formatPrice(product.storage[storage]!.priceCents) }}
      </button>
      <p v-if="added" class="mt-3 text-sm text-muted-foreground" role="status">
        Added. <RouterLink to="/bag" class="underline">Review your bag</RouterLink>
      </p>
    </div>
  </div>
</template>
