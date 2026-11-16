<script setup lang="ts">
import { storefront, launchSignup, soldOutSignup } from '~/content/storefront'
const config = useRuntimeConfig().public
const route = useRoute()
const commerce = computed(() => import.meta.dev && config.commerceSource === 'local'
  ? route.query.commerce !== 'waitlist'
  : config.storefrontMode === 'commerce')
const { product, quantity, maxQuantity, state, submitting, message, refresh, buy } = useCommerce(commerce)
const signupCopy = computed(() => state.value === 'sold-out' ? soldOutSignup
  : state.value === 'closed' ? launchSignup : null)
const signupFields = computed((): Record<string, string> => import.meta.dev && state.value === 'sold-out' ? { purpose: 'sold_out' } : {})
const signupEnabled = computed(() => state.value !== 'sold-out' || import.meta.dev)
const commerceRegion = ref<HTMLElement>()
watch(state, async (next, previous) => {
  if (previous !== 'available' || !['sold-out', 'closed', 'failed'].includes(next)) return
  await nextTick()
  const target = commerceRegion.value?.querySelector<HTMLElement>('h2') ?? commerceRegion.value
  target?.focus()
})
</script>

<template>
  <main class="product-page">
    <h1>{{ storefront.title }}</h1>
    <SarahCarousel />
    <p class="description">{{ storefront.description }}</p>
    <div ref="commerceRegion" tabindex="-1">
      <p v-if="state === 'loading'" class="commerce-status" role="status">🤖 LOADING 🤖</p>
      <PurchasePanel v-if="product && (state === 'available' || state === 'sold-out')" v-model:quantity="quantity"
        :product="product.product" :max-quantity="maxQuantity" :submitting="submitting" @buy="buy" />
      <SignupForm v-if="signupCopy" :key="state" v-bind="signupCopy"
        :endpoint="config.signupEndpoint" :site-key="config.turnstileSiteKey"
        :extra-fields="signupFields" :enabled="signupEnabled"
        unavailable-message="Email updates aren't available just yet. Please check back." />
      <p v-if="commerce" role="status" class="purchase-message">{{ message }}</p>
      <button v-if="state === 'failed'" type="button" class="retry" @click="refresh()">Try again? 🥺👉👈</button>
      <noscript v-if="commerce">Enable JavaScript to check availability and buy a blanket.</noscript>
    </div>
  </main>
</template>

<style scoped>
.product-page { width: calc(100% - 2rem); max-width: 40rem; margin-inline: auto; padding-block: 1rem calc(3.5rem + env(safe-area-inset-bottom, 0px)); }
h1 { margin-bottom: 1rem; font-size: 1.875rem; line-height: 1.2; font-weight: 700; text-align: center; }
.description { max-width: 28rem; margin: 2rem auto 0; }
.purchase + .signup { margin-top: 3rem; }
.commerce-status { max-width: 28rem; margin: 1.5rem auto 0; min-height: 17rem; text-align: center; }
.purchase-message:not(:empty) { max-width: 28rem; margin: 1rem auto 0; font-size: .875rem; text-align: center; }
.retry { display: block; margin: .75rem auto 0; }
@media (min-width: 48rem) { .product-page { width: calc(100% - 4rem); padding-block: 2rem; } }
</style>
