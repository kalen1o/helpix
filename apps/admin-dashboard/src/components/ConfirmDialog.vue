<script setup lang="ts">
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@helpix/ui'

defineProps<{
  open: boolean
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  busy?: boolean
  /** Shown inside the dialog, so a failed action is visible above the modal backdrop. */
  error?: string | null
}>()
const emit = defineEmits<{ 'update:open': [value: boolean]; confirm: [] }>()
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ description }}</DialogDescription>
      </DialogHeader>
      <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
      <DialogFooter>
        <Button variant="outline" @click="emit('update:open', false)">Cancel</Button>
        <Button :variant="destructive ? 'destructive' : 'default'" :disabled="busy" @click="emit('confirm')">
          {{ confirmLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
