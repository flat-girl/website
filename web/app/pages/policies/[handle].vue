<script setup lang="ts">
import { policyLinks } from '~/content/storefront'
import type { PolicyResponse } from '#shared/types/commerce'
import { isPolicyContent } from '#shared/utils/policy'

const route = useRoute()
const config = useRuntimeConfig().public
const commerceRequest = useCommerceRequest()
const logo = useImages().find(image => image.id === 'sarah-icon')
const entry = computed(() => policyLinks.find(p => p.handle === route.params.handle))
if (!entry.value) throw createError({ statusCode: 404, statusMessage: 'Policy not found' })
useHead({ title: () => `${entry.value?.title} — Boring Flat Girl` })
const policy = ref<PolicyResponse['policy']>(null)
const loading = ref(true)
const message = ref('')
let controller: AbortController | undefined

async function load() {
  controller?.abort()
  const request = new AbortController()
  controller = request
  const startedAt = performance.now()
  const timer = window.setTimeout(() => request.abort(), 10000)
  loading.value = true
  message.value = ''
  policy.value = null
  try {
    const path = `policies/${encodeURIComponent(String(route.params.handle))}`
    const response = await commerceRequest(path, () => {
      if (!config.commerceEndpoint) throw new Error('Policy endpoint not configured')
      return `${config.commerceEndpoint.replace(/\/$/, '')}/${path}`
    }, {
      signal: request.signal, redirect: 'error', cache: 'no-store',
    })
    if (response.status === 404) {
      if (controller === request) message.value = "This policy hasn't been published yet."
      return
    }
    if (!response.ok) throw new Error('Policy unavailable')
    const body = await response.json() as PolicyResponse
    if (body?.schemaVersion !== 1 || !body.policy || body.policy.handle !== route.params.handle
      || typeof body.policy.title !== 'string' || !Array.isArray(body.policy.paragraphs)
      || !body.policy.paragraphs.length || !body.policy.paragraphs.every(p => typeof p === 'string')) throw new Error('Invalid policy')
    if (body.policy.content !== undefined && !isPolicyContent(body.policy.content)) throw new Error('Invalid policy formatting')
    if (controller === request) policy.value = body.policy
  } catch {
    if (controller === request) message.value = 'This policy is currently unavailable. Please try again.'
  } finally {
    window.clearTimeout(timer)
    // Give the robot its moment without adding time to slower requests.
    const remaining = 750 - (performance.now() - startedAt)
    if (controller === request && remaining > 0) {
      await new Promise<void>(resolve => window.setTimeout(resolve, remaining))
    }
    if (controller === request) loading.value = false
  }
}
onMounted(load)
watch(() => route.params.handle, load)
onBeforeUnmount(() => { controller?.abort(); controller = undefined })
</script>

<template>
  <main class="policy-page">
    <NuxtLink to="/" class="back-link">
      <img v-if="logo" :src="logo.src" :srcset="logo.srcset" sizes="64px" width="64" height="64" alt="">
      <strong>Back to blanket</strong>
    </NuxtLink>
    <h1>{{ entry?.title }}</h1>
    <div v-if="entry?.notes?.length" class="policy-notes" role="note">
      <PolicyRichText v-for="(note, index) in entry.notes" :key="index" :trusted-html="note" />
    </div>
    <p v-if="loading" role="status">🤖 LOADING 🤖</p>
    <template v-else-if="policy">
      <PolicyRichText v-if="policy.content" :content="policy.content" />
      <template v-else>
        <p v-for="(paragraph, index) in policy.paragraphs" :key="index">{{ paragraph }}</p>
      </template>
    </template>
    <template v-else>
      <p role="status">{{ message }}</p>
      <button type="button" @click="load">Try again? 🥺👉👈</button>
    </template>
    <noscript>Enable JavaScript to load the current store policy.</noscript>
  </main>
</template>

<style scoped>
.policy-page { max-width: 40rem; width: calc(100% - 3rem); margin: 2rem auto 4rem; min-height: 50vh; overflow-wrap: anywhere; }
.back-link { display: inline-flex; align-items: center; gap: .75rem; }
.back-link img { width: 64px; height: 64px; border-radius: .5rem; object-fit: cover; }
h1 { font-size: 1.75rem; line-height: 1.2; margin: 2rem 0; }
p { margin-top: 1rem; white-space: pre-line; }
.policy-notes { margin-bottom: 1.5rem; }
.policy-notes :deep(.policy-content:first-child) { margin-top: 0; }
button { margin-top: 1rem; }
</style>
