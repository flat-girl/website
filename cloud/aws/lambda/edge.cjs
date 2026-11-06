const metaApi = typeof __meta !== 'undefined' ? __meta : require('./meta.cjs')
const header = (request, name) => request.headers?.[name]?.[0]?.value
function createHandler(env, deps) {
  return async (event, context) => {
    const cf = event.Records[0].cf, { request, response } = cf
    if (!response || request.method !== 'GET' || !['/', '/index.html'].includes(request.uri) ||
        response.status !== '200' || !/^text\/html(?:;|$)/i.test(header(response, 'content-type') || '') ||
        /prefetch/i.test([header(request, 'purpose'), header(request, 'sec-purpose')].join(' '))) return response
    if (env === 'production' && header(request, 'host') !== 'flatgirl.net') return response
    const budget = Math.min(500, (context?.getRemainingTimeInMillis?.() ?? 5000) - 1000)
    if (budget <= 0) return response
    const signal = AbortSignal.timeout(budget)
    try {
      const config = await deps.runtime.config(signal)
      if (config.mode === 'off') return response
      const now = (deps.now || Date.now)()
      const name = metaApi.cookieName(env)
      let fbc = metaApi.validFbc(metaApi.readCookie((request.headers.cookie || []).map(v => v.value), name), now)
      const ids = new URLSearchParams(request.querystring || '').getAll('fbclid')
      const click = ids.length === 1 && /^[A-Za-z0-9_-]{1,1024}$/.test(ids[0]) ? ids[0] : undefined
      if (config.captureEnabled && click && fbc?.split('.').slice(3).join('.') !== click) {
        fbc = `fb.1.${now}.${click}`
        const value = `${name}=${fbc}; Domain=flatgirl.net; Path=/; Max-Age=7776000; Expires=${new Date(now + 7776000000).toUTCString()}; Secure; HttpOnly; SameSite=Lax`
        response.headers['set-cookie'] = [...(response.headers['set-cookie'] || []), { key: 'Set-Cookie', value }]
      }
      if (header(request, 'sec-gpc') === '1' || !config.viewEnabled) return response
      const payload = metaApi.buildEvent('ViewContent', env, {
        id: `view:${env}:${cf.config.requestId}`, fbc, ip: request.clientIp, agent: header(request, 'user-agent'),
      }, now)
      await deps.runtime.send(payload, config, signal)
    } catch { deps.runtime.failure() }
    return response
  }
}
let handler
exports.handler = (event, context) => {
  if (!handler) handler = createHandler(__environment, { runtime: metaApi.createRuntime(__environment, { queueUrl: __queueUrl }) })
  return handler(event, context)
}
exports.createHandler = createHandler
