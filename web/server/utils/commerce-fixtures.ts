import type { ProductResponse } from '../../shared/types/commerce'

export function fixtureProduct(scenario: string, updated = false): ProductResponse {
  const soldOut = scenario === 'sold-out' || (updated && scenario === 'stock-changed')
  const quantity = soldOut ? 0 : scenario === 'low-stock' || (updated && scenario === 'quantity-changed') ? 2 : 327
  const changedPrice = updated && scenario === 'price-changed'
  return {
    schemaVersion: 1,
    salesOpen: scenario !== 'closed' && !(updated && scenario === 'sales-closed'),
    quantityLimit: 5,
    product: {
      id: 'gid://shopify/Product/15491665297684',
      title: 'Boring Flat Girl Plush Blanket',
      availableForSale: !soldOut,
      quantityAvailable: scenario === 'unknown-stock' ? null : quantity,
      price: { amount: changedPrice ? '64.00' : '60.00', currencyCode: 'USD' },
    },
  }
}
