const { createHash, timingSafeEqual } = require('node:crypto')
const parameter = '/flat-girl/admin/authorization-sha256'
function credentialReader(deps = {}) {
  let digest, until = 0, client
  const now = deps.now || Date.now
  const read = deps.read || (async signal => {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm')
    client ||= new SSMClient({ region: 'us-east-1', maxAttempts: 1 })
    return (await client.send(new GetParameterCommand({ Name: parameter, WithDecryption: true }), { abortSignal: signal })).Parameter?.Value
  })
  return async signal => {
    if (digest && now() < until) return digest
    digest = undefined
    const value = await read(signal)
    if (!/^[a-f0-9]{64}$/.test(value || '')) throw Error('auth_unavailable')
    digest = value; until = now() + 60000
    return digest
  }
}
function valid(header, digest) {
  return typeof header === 'string' && header.startsWith('Basic ') && header.length <= 1024 &&
    /^[a-f0-9]{64}$/.test(digest || '') && timingSafeEqual(createHash('sha256').update(header).digest(), Buffer.from(digest, 'hex'))
}
function createEdge(deps = {}) {
  const read = deps.read || credentialReader()
  const response = status => ({ status: String(status), headers: {
    'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
    'x-robots-tag': [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
    ...(status === 401 ? { 'www-authenticate': [{ key: 'WWW-Authenticate', value: 'Basic realm="Flat Girl Admin", charset="UTF-8"' }] } : {}),
  } })
  return async event => {
    const r = event.Records[0].cf.request
    const headers = r.headers.authorization
    if (headers?.length !== 1 || !headers[0].value?.startsWith('Basic ')) return response(401)
    try { if (!valid(headers[0].value, await read(AbortSignal.timeout(2500)))) return response(401) }
    catch { return response(503) }
    if ((r.headers.host?.[0]?.value || '').toLowerCase() !== 'admin.flatgirl.net') return response(404)
    if (r.uri.includes('..') || /%2e|%2f|%5c/i.test(r.uri) || r.uri.includes('/.')) return response(404)
    if (!r.uri.startsWith('/api/')) {
      delete r.headers.authorization
      if (r.uri === '/') r.uri = '/index.html'
      if (!['/index.html', '/200.html', '/404.html', '/robots.txt', '/build.json', '/_payload.json'].includes(r.uri) && !r.uri.startsWith('/_nuxt/')) return response(404)
    }
    return r
  }
}
exports.credentialReader = credentialReader
exports.valid = valid
exports.createEdge = createEdge
