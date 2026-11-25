import { test, expect } from '@playwright/test'
import { policyContent, createShopifyCommerce } from '../../shared/utils/shopify'
import { isPolicyContent } from '../../shared/utils/policy'

test('rich text retains headings, inline formatting, line breaks, lists and links', () => {
  const content = policyContent('<h2>Returns &amp; refunds</h2><div>All sales are <strong>final</strong>.<br><em>Thank you.</em></div><ol start="3"><li>Contact <a href="mailto:help@example.com">support</a>.</li></ol>')
  expect(content).toEqual([
    { type: 'element', tag: 'h2', children: [{ type: 'text', text: 'Returns & refunds' }] },
    { type: 'element', tag: 'div', children: [
      { type: 'text', text: 'All sales are ' },
      { type: 'element', tag: 'strong', children: [{ type: 'text', text: 'final' }] },
      { type: 'text', text: '.' }, { type: 'element', tag: 'br', children: [] },
      { type: 'element', tag: 'em', children: [{ type: 'text', text: 'Thank you.' }] },
    ] },
    { type: 'element', tag: 'ol', start: 3, children: [{ type: 'element', tag: 'li', children: [
      { type: 'text', text: 'Contact ' },
      { type: 'element', tag: 'a', href: 'mailto:help@example.com', children: [{ type: 'text', text: 'support' }] },
      { type: 'text', text: '.' },
    ] }] },
  ])
  expect(isPolicyContent(content)).toBe(true)
})

test('Shopify HTML cannot pass scripts, handlers, styles or dangerous links to the renderer', () => {
  const content = policyContent('<script>bad()</script><style>body{display:none}</style><svg onload="bad()"><a>bad</a></svg><p onclick="bad()" style="color:red">Fine <a href="java&#x73;cript:bad()">label</a><img src=x onerror="bad()">&lt;script&gt;literal&lt;/script&gt;</p>')
  expect(content).toEqual([{ type: 'element', tag: 'p', children: [
    { type: 'text', text: 'Fine ' }, { type: 'element', tag: 'a', children: [{ type: 'text', text: 'label' }] },
    { type: 'text', text: '<script>literal</script>' },
  ] }])
  expect(isPolicyContent(content)).toBe(true)
})

test('client rejects arbitrary element names, unsafe URLs and excessively deep content', () => {
  for (const content of [
    [{ type: 'element', tag: 'script', children: [] }],
    [{ type: 'element', tag: 'iframe', children: [] }],
    [{ type: 'element', tag: 'a', href: 'javascript:alert(1)', children: [] }],
    [{ type: 'element', tag: 'a', href: 'data:text/html,bad', children: [] }],
    [{ type: 'element', tag: 'p', children: 'not an array' }],
  ]) expect(isPolicyContent(content)).toBe(false)
  let deep: unknown = []
  for (let i = 0; i < 66; i++) deep = [{ type: 'element', tag: 'div', children: deep }]
  expect(isPolicyContent(deep)).toBe(false)
})

test('policy response includes rich text and compatible plain paragraphs', async () => {
  const fetcher = (async () => Response.json({ data: { shop: { policy: { title: 'Returns', body: '<p>All sales are <strong>final</strong>.</p>' } } } })) as typeof fetch
  const response = await createShopifyCommerce('test-token', fetcher).readPolicy('refund-policy')
  expect(response.policy?.paragraphs).toEqual(['All sales are final.'])
  expect(response.policy?.content).toEqual(policyContent('<p>All sales are <strong>final</strong>.</p>'))
})
