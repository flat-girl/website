export default defineEventHandler(async (event) => {
  // Static deployments use the configured signup API; this mock is dev-only.
  if (!import.meta.dev) throw createError({ statusCode: 404 })

  setHeader(event, 'cache-control', 'no-store')
  const body = await readBody(event)
  if (!body || typeof body.email !== 'string' || body.email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || body.website !== '' ||
      typeof body.turnstileToken !== 'string' || !body.turnstileToken.startsWith('local-signup-')) {
    throw createError({ statusCode: 400, statusMessage: 'Unable to process signup.' })
  }

  // No persistence, email delivery, or provider calls in local development.
  return { accepted: true }
})
