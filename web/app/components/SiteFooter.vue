<script setup lang="ts">
import { policyLinks } from '~/content/storefront'
</script>

<template>
  <footer>
    <a href="https://linktree.polis.tv">A project by Polis</a>
    <nav aria-label="Store policies">
      <NuxtLink v-for="policy in policyLinks" :key="policy.handle" :to="`/policies/${policy.handle}/`" :prefetch="false">{{ policy.title }}</NuxtLink>
    </nav>
  </footer>
</template>

<style scoped>
footer { padding: 0 1.5rem calc(3rem + env(safe-area-inset-bottom, 0px)); text-align: center; }
nav { max-width: 36rem; margin: 1.25rem auto 0; display: flex; justify-content: center; flex-wrap: wrap; gap: .5rem 1rem; font-size: .75rem; }
</style>
