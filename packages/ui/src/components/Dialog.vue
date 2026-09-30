<script setup lang="ts">
import { provide } from 'vue'
import { DIALOG_OPEN } from './dialogContext'

const open = defineModel<boolean>('open', { default: false })
provide(DIALOG_OPEN, open)
</script>

<template>
  <slot />
</template>
