<script setup lang="ts">
import type { ProductResponse } from '#shared/types/commerce'
import { storefront } from '~/content/storefront'
import { formatMoney } from '~/utils/commerce'
import shopifyBag from '~/assets/images/shopify-bag.svg'

const props = defineProps<{
  product: ProductResponse['product']
  maxQuantity: number
  submitting: boolean
}>()
const canBuy = computed(() => props.product.availableForSale && props.product.quantityAvailable !== 0)
const quantity = defineModel<number>('quantity', { required: true })
const emit = defineEmits<{ buy: [] }>()
</script>

<template>
  <section class="purchase" aria-label="Buy blanket" :aria-busy="submitting">
    <p class="price">{{ formatMoney(product.price) }}</p>
    <p class="shipping">{{ storefront.shipping }}</p>
    <p v-if="canBuy" aria-describedby="fulfillment-note">{{ storefront.fulfillment }}*</p>
    <p v-if="product.quantityAvailable !== null" class="stock" :class="{ 'sold-out': product.quantityAvailable === 0 }">Drop 1 - <strong>{{ product.quantityAvailable }}</strong> of <strong>{{ storefront.editionSize }}</strong> Remaining</p>
    <form class="purchase-form" @submit.prevent="emit('buy')">
      <div class="quantity" role="group" aria-label="Quantity">
        <button type="button" aria-label="Decrease quantity" :disabled="!canBuy || submitting || quantity <= 1" @click="quantity--">−</button>
        <output aria-label="Selected quantity" aria-live="polite">{{ canBuy ? quantity : 0 }}</output>
        <button type="button" aria-label="Increase quantity" :disabled="!canBuy || submitting || quantity >= maxQuantity" @click="quantity++">+</button>
      </div>
      <button type="submit" class="buy" :disabled="submitting || !canBuy">
        <span>{{ !canBuy ? 'Sold out' : submitting ? 'Starting checkout…' : 'Buy now' }}</span>
        <img :src="shopifyBag" width="22" height="25" alt="" aria-hidden="true">
      </button>
    </form>
    <p v-if="canBuy" id="fulfillment-note" class="fulfillment-note">*{{ storefront.fulfillmentNote }}</p>
  </section>
</template>

<style scoped>
.purchase { max-width: 28rem; margin: 1.5rem auto 0; text-align: center; }
.price { font-size: 1.5rem; font-weight: 700; }
.stock { margin-top: 0.75rem; }
.purchase-form { margin-top: 1.5rem; display: grid; justify-items: center; gap: 1rem; }
.quantity { display: flex; align-items: center; }
.quantity button { width: 2.75rem; height: 2.75rem; font-size: 1.25rem; }
.quantity output { min-width: 3rem; font-variant-numeric: tabular-nums; }
.buy { margin-top: 0.5rem; display: inline-flex; align-items: center; justify-content: center; gap: .5rem; background: #111; color: #fff; border-color: #111; min-width: 12rem; padding: .75rem 1.5rem; font-weight: 600; }
.buy img { width: 22px; height: auto; flex-shrink: 0; }
button:disabled { opacity: .4; cursor: not-allowed; }
.sold-out { text-decoration: line-through; }
.fulfillment-note { margin: 2.5rem auto 0; font-size: .75rem; color: #555; text-align: left; }
</style>
