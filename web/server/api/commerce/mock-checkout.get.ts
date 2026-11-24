export default defineEventHandler(event => {
  if (!import.meta.dev) throw createError({ statusCode: 404 })
  if (useRuntimeConfig(event).public.commerceSource !== 'local') throw createError({ statusCode: 404 })
  const quantity = Number(getQuery(event).quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) throw createError({ statusCode: 400 })
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'cache-control', 'no-store')
  setHeader(event, 'content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mock checkout — Boring Flat Girl</title><style>body{font:16px/1.5 system-ui;margin:4rem auto;padding:0 1.5rem;max-width:32rem;color:#111}a{color:inherit}</style></head><body><main><h1>Mock checkout</h1><p>${quantity} blanket${quantity === 1 ? '' : 's'} selected.</p><p>${quantity} × Stocking Stuffer Pack — Free</p><p>This is a local preview. No order was placed and no payment was taken.</p><a href="/">Back to blanket</a></main></body></html>`
})
