const { createHash, timingSafeEqual } = require('node:crypto')
const publicFiles = ['index.html', '200.html', '404.html', '_payload.json', 'robots.txt', 'build.json',
  'favicon.ico', 'favicon.svg', 'sitemap.xml']
const authParameter = '/flat-girl/beta/authorization-sha256'
function credentialReader(deps = {}) {
  let cached, expires = 0
  const now = deps.now || Date.now
  let read = deps.read
  if (!read) {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm')
    const client = new SSMClient({ region: 'us-east-1', maxAttempts: 1 })
    read = async signal => (await client.send(new GetParameterCommand({ Name: authParameter, WithDecryption: true }),
      { abortSignal: signal })).Parameter?.Value
  }
  return async signal => {
    if (cached && now() < expires) return cached
    cached = undefined
    const value = await read(signal)
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw Error('auth-configuration')
    cached = value; expires = now() + 60000
    return value
  }
}
function createHandler(env, deps = {}) {
  if (!['beta', 'production'].includes(env)) throw Error('environment')
  const beta = env === 'beta', host = beta ? 'beta.flatgirl.net' : 'flatgirl.net'
  const read = beta ? (deps.readCredential || credentialReader()) : undefined
  const response = (status, headers = {}) => ({ status: String(status), headers: {
    'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    ...(beta ? { 'x-robots-tag': [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }] } : {}), ...headers,
  } })
  const unauthorized = () => response(401, { 'www-authenticate': [{ key: 'WWW-Authenticate', value: 'Basic realm="Flat Girl Beta", charset="UTF-8"' }] })
  return async (event, context) => {
    const request = event.Records[0].cf.request
    if (beta) {
      const headers = request.headers.authorization, authorization = headers?.[0]?.value
      if (headers?.length !== 1 || typeof authorization !== 'string' || !authorization.startsWith('Basic ') || authorization.length > 1024)
        return unauthorized()
      const budget = Math.min(3000, (context?.getRemainingTimeInMillis?.() ?? 5000) - 1000)
      if (budget <= 0) return response(503)
      try {
        const expected = await read(AbortSignal.timeout(budget))
        if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) return response(503)
        const actual = createHash('sha256').update(authorization).digest()
        if (!timingSafeEqual(Buffer.from(expected, 'hex'), actual)) return unauthorized()
      } catch { return response(503) }
      delete request.headers.authorization
    }
    const uri = request.uri
    if (uri.includes('..') || /%2e|%2f|%5c/i.test(uri) || uri.includes('/.') || uri.startsWith('/variants/')) return response(404)
    const file = publicFiles.includes(uri.slice(1)) || uri.startsWith('/_nuxt/')
    const assetLike = file || uri.substring(uri.lastIndexOf('/') + 1).includes('.')
    const destination = uri === '/index.html' ? '/' : (uri === '/' || assetLike ? uri : '/')
    const incoming = (request.headers.host?.[0]?.value || '').toLowerCase()
    if (incoming !== host || destination !== uri) {
      return response(destination !== uri && uri !== '/index.html' ? 302 : 301, {
        location: [{ key: 'Location', value: `https://${host}${destination}${request.querystring ? '?' + request.querystring : ''}` }],
      })
    }
    return request
  }
}
const handler = typeof __environment === 'undefined' ? undefined : createHandler(__environment)
exports.handler = (event, context) => handler(event, context)
exports.createHandler = createHandler
exports.credentialReader = credentialReader
