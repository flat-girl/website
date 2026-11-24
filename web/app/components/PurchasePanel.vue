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
    <div v-if="canBuy" class="callout">
      <p class="callout-title"><strong><em>ATTENTION</em></strong></p>
      <p>
        We sold out of Drop 1, 500 units with guaranteed* fulfillment by Christmas.
        We are opening up <strong>Drop 2</strong>, an additional 500 units with fulfilment [as fast as we can but] <strong>AFTER</strong> Christmas.
      </p>
      <p>
        If you are buying this as a gift for someone, drop 2 comes with the following stocking stuffers / collectables that will be delivered <strong>BEFORE</strong> Christmas.
      </p>
      <ul>
        <li>1x Holographic Flat Girl Sticker</li>
        <li>1x Holographic Couch Sticker </li>
        <li>1x Flat Girl IOU Coupon</li>
      </ul>
      <p>
        Super cool renderings in the margin. A self-proclaimed $16 value for <strong>FREE!</strong> Our GOAT is generous, in flat girl we trust 🫡
      </p>
    </div>
    <div class="purchase-controls">
      <StockingStufferArt />
      <p class="price">{{ formatMoney(product.price) }}</p>
      <p class="shipping">{{ storefront.shipping }}</p>
      <p v-if="canBuy">Free Stocking Stuffers</p>
      <p v-if="canBuy" aria-describedby="fulfillment-note">{{ storefront.fulfillment }}</p>
      <p class="stock sold-out">Drop 1 - <strong>0</strong> of <strong>500</strong> Remaining</p>
      <p v-if="product.quantityAvailable !== null" class="stock" :class="{ 'sold-out': product.quantityAvailable === 0 }">Drop 2 - <strong>{{ product.quantityAvailable }}</strong> of <strong>{{ storefront.editionSize }}</strong> Remaining</p>
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
    </div>
    <p v-if="canBuy" id="fulfillment-note" class="fulfillment-note">*Guarantees are hard this day and age 🤷‍♂️</p>
  </section>
</template>

<style scoped>
.purchase { --bottom-art-offset: clamp(2rem, 10vw, 3.5rem); display: flex; flex-direction: column; max-width: 28rem; margin: 1.5rem auto 0; text-align: center; }
.callout { margin-bottom: 1.5rem; text-align: left; }
.callout p + p { margin-top: 1rem; }
.callout-title { text-align: center; }
.purchase-controls {
  position: relative;
  isolation: isolate;
  display: grid;
  align-content: center;
  min-height: min(calc(100vw - 2rem), 28rem);
  margin-bottom: var(--bottom-art-offset);
}
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
.fulfillment-note { margin: 2.5rem auto 0; font-size: .75rem; color: #555; }
@media (max-width: 30rem) {
  .purchase { --bottom-art-offset: calc(10vw + 0.75rem); }
  .purchase-controls { padding-block: 2.5rem; }
}
</style>
