import type { Money, ProductResponse } from '#shared/types/commerce'

export function isMoney(value: unknown): value is Money {
  if (!value || typeof value !== 'object') return false
  const money = value as Money
  return money.currencyCode === 'USD' && typeof money.amount === 'string'
    && /^(0|[1-9]\d{0,6})\.\d{2}$/.test(money.amount)
}

export function parseProduct(value: unknown): ProductResponse {
  const data = value as ProductResponse | null
  const p = data?.product
  if (data?.schemaVersion !== 1 || typeof data.salesOpen !== 'boolean'
    || !Number.isInteger(data.quantityLimit) || data.quantityLimit < 1 || data.quantityLimit > 5
    || !p || typeof p.id !== 'string' || !p.id || typeof p.variantId !== 'string' || !p.variantId
    || typeof p.title !== 'string' || typeof p.availableForSale !== 'boolean' || !isMoney(p.price)
    || (p.quantityAvailable !== null && (!Number.isSafeInteger(p.quantityAvailable) || p.quantityAvailable < 0))
    || (p.availableForSale && p.quantityAvailable === 0)) throw new Error('Invalid product response')
  return data
}

export function formatMoney(money: Money) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: money.currencyCode,
    minimumFractionDigits: money.amount.endsWith('.00') ? 0 : 2 }).format(Number(money.amount))
}

export function checkoutDestination(value: unknown, hosts: string[], localOrigin?: string): string {
  if (typeof value !== 'string') throw new Error('Invalid checkout destination')
  const url = new URL(value, localOrigin)
  if (url.username || url.password) throw new Error('Invalid checkout destination')
  if (import.meta.dev && localOrigin) {
    // Local development cannot hand off to a real checkout, even if a response is wrong.
    if (url.origin === localOrigin && url.pathname === '/api/commerce/mock-checkout' && !url.hash) return url.href
    throw new Error('Invalid local checkout destination')
  }
  if (url.protocol !== 'https:' || url.port || !hosts.includes(url.hostname)) throw new Error('Invalid checkout destination')
  return url.href
}
