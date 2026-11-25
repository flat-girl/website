import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import type { Money, PolicyResponse, ProductResponse } from '../types/commerce'
import { policyTags, safePolicyHref, type PolicyNode } from './policy'

const host = 'tepwtx-zw.myshopify.com'
const productId = 'gid://shopify/Product/15491665297684'
const blanketVariantId = 'gid://shopify/ProductVariant/68124854681876'
const packVariantId = 'gid://shopify/ProductVariant/68279777100052'
const checkoutHosts = [host, 'flatgirl.myshopify.com', 'shopify.flatgirl.net']
const policyFields: Record<string, string> = {
  'refund-policy': 'refundPolicy', 'privacy-policy': 'privacyPolicy',
  'shipping-policy': 'shippingPolicy', 'terms-of-service': 'termsOfService',
  'contact-information': 'contactInformation', 'legal-notice': 'legalNotice',
}

export class CommerceError extends Error {
  constructor(public status: number, public code: string) { super(code) }
}

function money(value: unknown): Money {
  const m = value as { amount?: unknown; currencyCode?: unknown } | null
  if (m?.currencyCode !== 'USD' || typeof m.amount !== 'string' || !/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(m.amount)) {
    throw new CommerceError(502, 'INVALID_SHOPIFY_RESPONSE')
  }
  const [whole, cents = ''] = m.amount.split('.')
  return { amount: `${whole}.${cents.padEnd(2, '0')}`, currencyCode: 'USD' }
}

export function policyContent(html: string): PolicyNode[] {
  function visit(node: DefaultTreeAdapterTypes.Node, depth = 0): PolicyNode[] {
    if (depth > 64) return []
    if ('value' in node) return [{ type: 'text', text: node.value }]
    if (!('childNodes' in node)) return []
    const tag = 'tagName' in node ? node.tagName : ''
    if (['script', 'style', 'template', 'noscript', 'svg', 'math', 'iframe', 'object', 'embed', 'form'].includes(tag)) return []
    const children = node.childNodes.flatMap(child => visit(child, depth + 1))
    if (!policyTags.includes(tag as typeof policyTags[number])) return children
    const result: PolicyNode = { type: 'element', tag: tag as typeof policyTags[number], children }
    if ('attrs' in node) {
      if (tag === 'a') {
        const href = node.attrs.find(a => a.name === 'href')?.value
        if (href) {
          try {
            const absolute = new URL(href, `https://${host}`).href
            if (safePolicyHref(absolute)) result.href = absolute
          } catch { /* Keep the label without an unsafe/invalid link. */ }
        }
      }
      if (tag === 'ol') {
        const start = node.attrs.find(a => a.name === 'start')?.value
        if (start && /^-?\d+$/.test(start) && Number.isSafeInteger(Number(start))) result.start = Number(start)
      }
    }
    return [result]
  }
  return visit(parseFragment(html))
}

export function policyParagraphs(html: string): string[] {
  const blocks = new Set(['p', 'div', 'section', 'article', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table'])
  function visit(node: DefaultTreeAdapterTypes.Node): string {
    if ('value' in node) return node.value.replace(/\s+/g, ' ')
    if (!('childNodes' in node)) return ''
    const tag = 'tagName' in node ? node.tagName : ''
    if (['script', 'style', 'template', 'noscript', 'svg', 'iframe'].includes(tag)) return ''
    if (tag === 'br') return '\n'
    let text = node.childNodes.map(visit).join('')
    if (tag === 'a' && 'attrs' in node) {
      const href = node.attrs.find(a => a.name === 'href')?.value
      if (href) {
        try {
          const url = new URL(href, `https://${host}`)
          if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)
            && text.trim() !== url.href && text.trim() !== href) text += ` (${url.href})`
        } catch { /* Keep the link's text if its URL is invalid. */ }
      }
    }
    if (tag === 'li') {
      let marker = '•'
      if ('parentNode' in node && node.parentNode && 'tagName' in node.parentNode && node.parentNode.tagName === 'ol') {
        const siblings = node.parentNode.childNodes.filter(n => 'tagName' in n && n.tagName === 'li')
        marker = `${siblings.indexOf(node as DefaultTreeAdapterTypes.ChildNode) + 1}.`
      }
      return `\n${marker} ${text.trim()}\n`
    }
    if (tag === 'td' || tag === 'th') return `${text}\t`
    if (tag === 'tr') return `\n${text}\n`
    return blocks.has(tag) ? `\n\n${text}\n\n` : text
  }
  return visit(parseFragment(html)).split(/\n\s*\n/).map(p => p.split('\n').map(l => l.trim()).join('\n').trim()).filter(Boolean)
}

export function previewStockOverride(url: URL): number | undefined {
  const local = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)
  if (!local && url.origin !== 'https://beta.flatgirl.net') return
  const values = url.searchParams.getAll('FORCE_STOCK')
  const value = values[0]
  if (values.length !== 1 || !value || !/^\d+$/.test(value)) return
  const stock = Number(value)
  if (Number.isSafeInteger(stock)) return stock
}

export function createShopifyCommerce(token: string, fetcher: typeof fetch = fetch, access: 'private' | 'public' = 'private',
  stockOverride?: number) {
  async function query(document: string, variables: Record<string, unknown> = {}) {
    if (!token || /\s/.test(token)) throw new CommerceError(503, 'SHOPIFY_NOT_CONFIGURED')
    let response: Response
    let body: any
    try {
      response = await fetcher(`https://${host}/api/2026-10/graphql.json`, {
        method: 'POST', headers: { 'content-type': 'application/json', [access === 'public' ? 'X-Shopify-Storefront-Access-Token' : 'Shopify-Storefront-Private-Token']: token },
        body: JSON.stringify({ query: document, variables }), redirect: 'error',
        signal: AbortSignal.timeout(8000),
      })
      if (!response.ok) throw new CommerceError(response.status === 429 ? 429 : 502,
        [401, 403].includes(response.status) ? 'SHOPIFY_AUTH_FAILED' : 'UNAVAILABLE')
      body = await response.json()
    } catch (error) {
      if (error instanceof CommerceError) throw error
      // Do not log/forward fetch errors: request options contain the private token.
      throw new CommerceError(503, 'UNAVAILABLE')
    }
    if (body?.errors?.length || !body?.data || typeof body.data !== 'object') throw new CommerceError(502, 'INVALID_SHOPIFY_RESPONSE')
    return body.data
  }

  async function readProduct(): Promise<ProductResponse> {
    const data = await query(`query Blanket($id: ID!) {
      product(id: $id) {
        id title ${stockOverride === undefined ? 'availableForSale totalInventory' : ''}
        priceRange {
          minVariantPrice { amount currencyCode }
          maxVariantPrice { amount currencyCode }
        }
      }
    }`, { id: productId })
    const p = data.product
    const inventory = stockOverride ?? p?.totalInventory
    const available = stockOverride === undefined ? p?.availableForSale : stockOverride > 0
    if (!p || p.id !== productId || typeof p.title !== 'string'
      || typeof available !== 'boolean'
      || (inventory !== null && (!Number.isSafeInteger(inventory) || inventory < 0))) {
      throw new CommerceError(502, 'INVALID_SHOPIFY_RESPONSE')
    }
    const price = money(p.priceRange?.minVariantPrice)
    const maxPrice = money(p.priceRange?.maxVariantPrice)
    // The storefront offers one price; don't guess if Shopify returns a price range.
    if (price.amount !== maxPrice.amount) throw new CommerceError(502, 'INVALID_SHOPIFY_RESPONSE')
    return { schemaVersion: 1, salesOpen: true, quantityLimit: 5, product: {
      id: productId, title: p.title,
      availableForSale: available && inventory !== 0,
      quantityAvailable: inventory, price,
    } }
  }

  async function readPolicy(handle: string): Promise<PolicyResponse> {
    const field = Object.hasOwn(policyFields, handle) ? policyFields[handle] : undefined
    if (!field) throw new CommerceError(404, 'POLICY_NOT_FOUND')
    const data = await query(`query StorePolicy { shop { policy: ${field} { title body } } }`)
    if (!data.shop || !Object.hasOwn(data.shop, 'policy')) throw new CommerceError(502, 'INVALID_SHOPIFY_RESPONSE')
    const policy = data.shop.policy
    if (policy === null) return { schemaVersion: 1, policy: null }
    if (!policy || typeof policy.title !== 'string' || typeof policy.body !== 'string' || policy.body.length > 131072) {
      throw new CommerceError(502, 'INVALID_SHOPIFY_RESPONSE')
    }
    const paragraphs = policyParagraphs(policy.body)
    return { schemaVersion: 1, policy: paragraphs.length ? { handle, title: policy.title, paragraphs, content: policyContent(policy.body) } : null }
  }

  async function createCheckout(input: unknown) {
    const request = input as { quantity?: unknown; expectedUnitPrice?: Money } | null
    if (!request || !Number.isInteger(request.quantity) || (request.quantity as number) < 1 || (request.quantity as number) > 5
      || request.expectedUnitPrice?.currencyCode !== 'USD' || typeof request.expectedUnitPrice.amount !== 'string'
      || !/^(0|[1-9]\d{0,6})\.\d{2}$/.test(request.expectedUnitPrice.amount)) throw new CommerceError(400, 'INVALID_REQUEST')
    const quantity = request.quantity as number
    const { product } = await readProduct()
    if (!product.availableForSale) throw new CommerceError(409, 'SOLD_OUT')
    if (product.quantityAvailable !== null && quantity > product.quantityAvailable) throw new CommerceError(409, 'QUANTITY_UNAVAILABLE')
    if (request.expectedUnitPrice.amount !== product.price.amount) throw new CommerceError(409, 'PRICE_CHANGED')
    const data = await query(`mutation BuyBlanket($input: CartInput!) @inContext(country: US) {
      cartCreate(input: $input) {
        cart { checkoutUrl totalQuantity cost { subtotalAmount { amount currencyCode } }
          lines(first: 2) { nodes { quantity merchandise { ... on ProductVariant { id } } cost { totalAmount { amount currencyCode } } } }
        } userErrors { code } warnings { code }
      }
    }`, { input: { lines: [{ merchandiseId: blanketVariantId, quantity }, { merchandiseId: packVariantId, quantity }],
      buyerIdentity: { countryCode: 'US' } } })
    const result = data.cartCreate
    if (!result || !Array.isArray(result.userErrors) || !Array.isArray(result.warnings)
      || result.userErrors.length || result.warnings.length) throw new CommerceError(503, 'UNAVAILABLE')
    const cart = result.cart
    const lines = cart?.lines?.nodes
    if (!cart || cart.totalQuantity !== 2 * quantity || !Array.isArray(lines) || lines.length !== 2) throw new CommerceError(503, 'UNAVAILABLE')
    const blanket = lines.find(line => line?.merchandise?.id === blanketVariantId)
    const pack = lines.find(line => line?.merchandise?.id === packVariantId)
    if (blanket?.quantity !== quantity || pack?.quantity !== quantity || money(pack.cost?.totalAmount).amount !== '0.00') {
      throw new CommerceError(503, 'UNAVAILABLE')
    }
    const subtotal = money(cart.cost?.subtotalAmount)
    const unitCents = Number(product.price.amount.replace('.', ''))
    if (money(blanket.cost?.totalAmount).amount !== subtotal.amount
      || Number(subtotal.amount.replace('.', '')) !== unitCents * quantity) throw new CommerceError(409, 'PRICE_CHANGED')
    let url: URL
    try { url = new URL(cart.checkoutUrl) } catch { throw new CommerceError(502, 'INVALID_CHECKOUT_URL') }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !checkoutHosts.includes(url.hostname)) {
      throw new CommerceError(502, 'INVALID_CHECKOUT_URL')
    }
    return { checkoutUrl: url.href }
  }

  return { readProduct, readPolicy, createCheckout }
}
