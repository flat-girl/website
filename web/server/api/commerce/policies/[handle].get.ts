import type { PolicyResponse } from '../../../../shared/types/commerce'
import { shopifySource, commerceResult } from '../../../utils/commerce-source'

// Editable local drafts. The shared source switch can read Shopify instead.
const policies: Record<string, { title: string; paragraphs: string[] }> = {
  'refund-policy': {
    title: 'Return & Refund Policy',
    paragraphs: ['All sales are final. We do not accept change-of-mind returns.',
      'If your blanket is damaged in shipping, contact us with your order information and photos so we can arrange a replacement. If a replacement is unavailable, we will arrange a refund.',
      'We offer no additional voluntary warranty. This policy does not limit rights or remedies available under applicable law.'],
  },
  'privacy-policy': {
    title: 'Privacy Policy',
    paragraphs: ['The published privacy policy will be loaded from Shopify. It must also cover this website’s email signup, bot verification and analytics services.'],
  },
  'shipping-policy': {
    title: 'Shipping Policy',
    paragraphs: ['Shipping is free within the contiguous United States. Shipping to Alaska, Hawaii and Guam is charged at checkout.',
      'We expect blankets to arrive by Christmas, but delivery dates are estimates. Unexpected production or carrier delays may affect timing.',
      'If we cannot ship within the promised timeframe, we will notify you with an updated estimate and the applicable options to accept the delay or cancel for a refund.'],
  },
  'terms-of-service': {
    title: 'Terms of Service',
    paragraphs: ['Purchases are subject to availability and our shipping and refund policies. Checkout is handled by Shopify.',
      'A blanket is not reserved simply by opening checkout. Final availability, taxes and any shipping charges are confirmed at checkout.'],
  },
  'contact-information': {
    title: 'Contact',
    paragraphs: ['Business name, support email, phone number and business address still need to be supplied in Shopify before launch.'],
  },
}

export default defineEventHandler(event => {
  if (!import.meta.dev) throw createError({ statusCode: 404 })
  setHeader(event, 'cache-control', 'no-store')
  const handle = getRouterParam(event, 'handle') || ''
  const shopify = shopifySource(event)
  if (shopify) return commerceResult(event, async () => {
    const result = await shopify.readPolicy(handle)
    if (!result.policy) setResponseStatus(event, 404)
    return result
  })
  const policy = Object.hasOwn(policies, handle) ? policies[handle] : undefined
  if (!policy) { setResponseStatus(event, 404); return { schemaVersion: 1, policy: null } }
  return { schemaVersion: 1, policy: { handle, title: policy.title,
    paragraphs: ['Local policy draft — not yet published.', ...policy.paragraphs] } } satisfies PolicyResponse
})
