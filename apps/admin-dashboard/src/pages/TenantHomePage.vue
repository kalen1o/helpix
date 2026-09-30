<script setup lang="ts">
import { Card, CardDescription, CardHeader, CardTitle } from '@helpix/ui'
import { session } from '@/auth/session'
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Welcome, {{ session.state.me?.tenant?.name }}</CardTitle>
      <CardDescription>Knowledge base, agent settings and conversations will appear here in the next milestones.</CardDescription>
    </CardHeader>
  </Card>
</template>
