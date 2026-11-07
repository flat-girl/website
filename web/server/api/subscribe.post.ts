export default defineEventHandler(async (event) => {
  // Static deployments use the configured signup API; this mock is dev-only.
  if (!import.meta.dev) throw createError({ statusCode: 404 })

  setHeader(event, 'cache-control', 'no-store')
  const body = await readBody(event)
  if (!body || typeof body.email !== 'string' || body.email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || body.website !== '' ||
      body.turnstileToken !== 'XXXX.DUMMY.TOKEN.XXXX') {
    throw createError({ statusCode: 400, statusMessage: 'Unable to process signup.' })
  }

  // Local-only scenarios; normal email validation still runs first.
  switch (body.email.trim().toLowerCase()) {
    case 'rate-limit@example.com':
      throw createError({ statusCode: 429, statusMessage: 'Simulated rate limit.' })
    case 'verification@example.com':
      throw createError({ statusCode: 403, statusMessage: 'Simulated verification rejection.' })
    case 'server-error@example.com':
      throw createError({ statusCode: 503, statusMessage: 'Simulated provider failure.' })
    case 'timeout@example.com':
      // The form aborts at 18 seconds. Release the delay if the client disconnects.
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          event.node.res.off('close', finish)
          resolve()
        }
        const timer = setTimeout(finish, 20000)
        event.node.res.once('close', finish)
      })
      break
    case 'malformed@example.com':
      setHeader(event, 'content-type', 'application/json')
      return '{"accepted":'
    case 'unexpected@example.com':
      return { accepted: false }
  }

  // Accept only Cloudflare's test token. No persistence, email, or provider calls here.
  return { accepted: true }
})
