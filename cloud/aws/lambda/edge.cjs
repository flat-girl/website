const metaApi = typeof __meta !== 'undefined' ? __meta : require('./meta.cjs')
const header = (request, name) => request.headers?.[name]?.[0]?.value
function createHandler(env, deps) {
  return async (event, context) => {
    const cf = event.Records[0].cf, { request, response } = cf
    if (!response || request.method !== 'GET' || !['/', '/index.html'].includes(request.uri) ||
        !['200', '304'].includes(response.status) ||
        (response.status === '200' && !/^text\/html(?:;|$)/i.test(header(response, 'content-type') || '')) ||
        /prefetch/i.test([header(request, 'purpose'), header(request, 'sec-purpose')].join(' '))) return response
    if (env === 'production' && header(request, 'host') !== 'flatgirl.net') return response
    const budget = Math.min(3000, (context?.getRemainingTimeInMillis?.() ?? 5000) - 1000)
    if (budget <= 0) { deps.runtime.failure('edge_budget_exhausted'); return response }
    const signal = AbortSignal.timeout(budget)
    let stage = 'edge_payload_failed'
    try {
      const now = (deps.now || Date.now)()
      const name = metaApi.cookieName(env)
      let fbc = metaApi.validFbc(metaApi.readCookie((request.headers.cookie || []).map(v => v.value), name), now)
      const ids = new URLSearchParams(request.querystring || '').getAll('fbclid')
      const click = ids.length === 1 && /^[A-Za-z0-9_-]{1,1024}$/.test(ids[0]) ? ids[0] : undefined
      if (click && fbc?.split('.').slice(3).join('.') !== click) {
        fbc = `fb.1.${now}.${click}`
        const value = `${name}=${fbc}; Domain=flatgirl.net; Path=/; Max-Age=7776000; Expires=${new Date(now + 7776000000).toUTCString()}; Secure; HttpOnly; SameSite=Lax`
        response.headers['set-cookie'] = [...(response.headers['set-cookie'] || []), { key: 'Set-Cookie', value }]
      }
      if (header(request, 'sec-gpc') === '1') { deps.runtime.progress?.('view_gpc_skipped'); return response }
      const payload = metaApi.buildEvent('ViewContent', env, {
        id: `view:${env}:${cf.config.requestId}`, fbc, ip: request.clientIp, agent: header(request, 'user-agent'),
      }, now)
      stage = 'edge_enqueue_failed'
      await deps.runtime.send(payload, signal)
    } catch { deps.runtime.failure(stage) }
    return response
  }
}
// Initialize the SQS client during Lambda initialization, before the request deadline.
const handler = typeof __environment === 'undefined' ? undefined : createHandler(__environment, {
  runtime: metaApi.createRuntime(__environment, { queueUrl: __queueUrl, initializeQueue: true }),
})
exports.handler = (event, context) => handler(event, context)
exports.createHandler = createHandler
