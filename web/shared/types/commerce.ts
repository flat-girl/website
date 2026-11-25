import type { PolicyNode } from '../utils/policy'

export interface Money { amount: string; currencyCode: 'USD' }

export interface ProductResponse {
  schemaVersion: 1
  salesOpen: boolean
  product: {
    id: string
    title: string
    availableForSale: boolean
    quantityAvailable: number | null
    price: Money
  }
  quantityLimit: number
}

export interface CheckoutRequest { quantity: number; expectedUnitPrice: Money }
export interface CheckoutResponse { checkoutUrl: string }

// Supported rich-text elements, plus paragraphs for older API consumers.
// Shopify remains the editing source; never render arbitrary API HTML.
export interface PolicyResponse {
  schemaVersion: 1
  policy: { handle: string; title: string; paragraphs: string[]; content?: PolicyNode[] } | null
}
