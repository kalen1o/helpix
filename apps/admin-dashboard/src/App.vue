<script setup lang="ts">
import { MotionConfig } from 'motion-v'
</script>

<template>
  <!-- Reduced motion: Motion drops transform and layout animation and keeps opacity. -->
  <MotionConfig reduced-motion="user">
    <RouterView />
  </MotionConfig>
</template>
