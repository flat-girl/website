import { toValue, type MaybeRefOrGetter } from 'vue'
import type { ProductResponse, CheckoutResponse } from '#shared/types/commerce'
import { parseProduct, checkoutDestination } from '~/utils/commerce'

export function useCommerce(enabled: MaybeRefOrGetter<boolean> = true) {
  const config = useRuntimeConfig().public
  const commerceRequest = useCommerceRequest()
  const route = useRoute()
  const product = ref<ProductResponse | null>(null)
  const quantity = ref(1)
  const loading = ref(true)
  const submitting = ref(false)
  const message = ref('')
  const failed = ref(false)
  let disposed = false
  let updatedFixture = false
  let readController: AbortController | undefined
  let checkoutController: AbortController | undefined
  const maxQuantity = computed(() => Math.min(5, product.value?.quantityLimit ?? 5,
    product.value?.product.quantityAvailable ?? 5))
  const state = computed(() => {
    if (!toValue(enabled)) return 'closed'
    if (loading.value) return 'loading'
    if (failed.value || !product.value) return 'failed'
    if (!product.value.salesOpen) return 'closed'
    return product.value.product.availableForSale ? 'available' : 'sold-out'
  })

  function endpoint(path: string) {
    const base = config.commerceEndpoint.replace(/\/$/, '')
    if (!base) throw new Error('Commerce not configured')
    let url = `${base}/${path}`
    if (import.meta.dev) {
      const params = new URLSearchParams()
      if (typeof route.query.FORCE_STOCK === 'string') params.set('FORCE_STOCK', route.query.FORCE_STOCK)
      if (config.commerceSource === 'local' && typeof route.query.commerce === 'string') params.set('scenario', route.query.commerce)
      if (updatedFixture) params.set('updated', '1')
      url += `?${params}`
    }
    return url
  }

  async function refresh(clearMessage = true) {
    if (!toValue(enabled)) return
    readController?.abort()
    const controller = new AbortController()
    readController = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    if (!product.value) loading.value = true
    failed.value = false
    if (clearMessage) message.value = ''
    try {
      const response = await commerceRequest('product', () => endpoint('product'), { signal: controller.signal, cache: 'no-store', redirect: 'error' })
      if (!response.ok) throw new Error('Product unavailable')
      const data = parseProduct(await response.json())
      if (disposed || readController !== controller) return
      const oldPrice = product.value?.product.price.amount
      product.value = data
      if (data.product.availableForSale && quantity.value > maxQuantity.value) {
        quantity.value = maxQuantity.value
        message.value = `Stock changed. Quantity adjusted to ${quantity.value}. Please review before buying.`
      } else if (oldPrice && oldPrice !== data.product.price.amount) {
        message.value = 'The price changed. Please review it before buying.'
      }
    } catch {
      if (disposed || readController !== controller) return
      failed.value = true
      product.value = null
      message.value = 'Availability could not load. Please try again.'
    } finally {
      window.clearTimeout(timer)
      if (!disposed && readController === controller) {
        loading.value = false
        readController = undefined
      }
    }
  }

  async function buy() {
    if (submitting.value || state.value !== 'available' || !product.value) return
    if (!Number.isInteger(quantity.value) || quantity.value < 1 || quantity.value > maxQuantity.value) return
    submitting.value = true
    message.value = ''
    // A background read must not replace the price while creating checkout.
    readController?.abort()
    readController = undefined
    const controller = new AbortController()
    checkoutController = controller
    const timer = window.setTimeout(() => controller.abort(), 15000)
    let handingOff = false
    try {
      const response = await commerceRequest('checkout', () => endpoint('checkout'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quantity: quantity.value, expectedUnitPrice: product.value.product.price }),
        signal: controller.signal, redirect: 'error',
      })
      const body = await response.json()
      if (disposed) return
      if (!response.ok) {
        const code = body?.error?.code
        if ((response.status === 409 && ['SOLD_OUT', 'QUANTITY_UNAVAILABLE', 'PRICE_CHANGED'].includes(code))
          || (response.status === 403 && code === 'SALES_CLOSED')) {
          if (import.meta.dev && config.commerceSource === 'local') updatedFixture = true
          message.value = code === 'PRICE_CHANGED' ? 'The price changed. Please review it before buying.'
            : 'Availability changed. Please review before buying.'
          await refresh(false)
          return
        }
        message.value = response.status === 429 ? 'Too many requests. Please wait a moment and try again.'
          : response.status === 400 ? 'Please check your quantity and try again.'
            : 'Checkout could not open. Please try again.'
        return
      }
      if (response.status !== 201) throw new Error('Unexpected checkout response')
      const destination = checkoutDestination((body as CheckoutResponse)?.checkoutUrl,
        config.checkoutHosts.split(',').map(host => host.trim()),
        import.meta.dev && config.commerceSource === 'local' ? window.location.origin : undefined)
      window.location.assign(destination)
      handingOff = true
    } catch {
      if (!disposed) message.value = 'Checkout could not open. Please try again.'
    } finally {
      window.clearTimeout(timer)
      if (!handingOff) submitting.value = false
      checkoutController = undefined
    }
  }

  function returnToPage() {
    // pageshow also covers Back from the mock or Shopify checkout via bfcache.
    if (!toValue(enabled) || document.visibilityState === 'hidden' || checkoutController || readController) return
    submitting.value = false
    void refresh()
  }
  onMounted(() => {
    void refresh()
    window.addEventListener('focus', returnToPage)
    window.addEventListener('pageshow', returnToPage)
  })
  onBeforeUnmount(() => {
    disposed = true
    readController?.abort()
    checkoutController?.abort()
    window.removeEventListener('focus', returnToPage)
    window.removeEventListener('pageshow', returnToPage)
  })
  watch(() => [toValue(enabled), import.meta.dev && config.commerceSource === 'local' ? route.query.commerce : undefined], () => {
    updatedFixture = false
    if (toValue(enabled)) { void refresh(); return }
    readController?.abort()
    checkoutController?.abort()
    readController = undefined
    product.value = null
    loading.value = true
    message.value = ''
  })
  return { product, quantity, maxQuantity, state, submitting, message, refresh, buy }
}
