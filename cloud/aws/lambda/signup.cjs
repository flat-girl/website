const metaApi = typeof __meta !== 'undefined' ? __meta : require('./meta.cjs')
// Inline CommonJS keeps the existing no-asset CDK deployment workflow.
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const ids = value => Array.isArray(value) && value.every(id => Number.isSafeInteger(id) && id > 0)
const response = statusCode => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(statusCode === 200 ? { accepted: true } : { error: 'Unable to process signup.' }),
})

function parse(event) {
  if (typeof event.body !== 'string' || event.body.length > 8192) return null
  if (event.isBase64Encoded && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.body)) return null
  let body, input
  try {
    body = event.isBase64Encoded ? new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(event.body, 'base64')) : event.body
    if (Buffer.byteLength(body) > 4096) return null
    input = JSON.parse(body)
  } catch { return null }
  if (!isObject(input) || Object.keys(input).sort().join(',') !== 'email,turnstileToken,website' ||
      input.website !== '' || typeof input.email !== 'string' || typeof input.turnstileToken !== 'string') return null
  const email = input.email.trim()
  const [local, domain, extra] = email.split('@')
  if (email.length > 254 || extra !== undefined || !local || local.length > 64 ||
      !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      !domain?.includes('.') || domain.split('.').some(label => label.length > 63 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) ||
      input.turnstileToken.length < 1 || input.turnstileToken.length > 2048) return null
  return { email, token: input.turnstileToken }
}

function createHandler(settings, dependencies) {
  return async (event, context) => {
    const start = Date.now()
    // Whitelisted labels only: exceptions, URLs and provider payloads can contain PII or secrets.
    const finish = (status, outcome) => {
      dependencies.log({ outcome, durationMs: Date.now() - start })
      return response(status)
    }
    if (!settings.enabled || ![5, 4].includes(settings.listId)) return finish(503, 'disabled')
    if (event.requestContext?.http?.method !== 'POST') return finish(405, 'validation_rejected')
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
    if (headers.origin !== settings.origin) return finish(403, 'validation_rejected')
    if (typeof headers['content-type'] !== 'string' || headers['content-type'].split(';')[0].trim().toLowerCase() !== 'application/json')
      return finish(415, 'validation_rejected')
    const input = parse(event)
    if (!input) return finish(400, 'validation_rejected')
    const signal = AbortSignal.timeout(12000)
    let stage = 'secrets'
    try {
      const secrets = await dependencies.secrets(signal)
      stage = 'turnstile'
      const verification = await dependencies.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: secrets.turnstile, response: input.token }),
      })
      if (!verification.ok) throw new Error('upstream')
      const verified = await verification.json()
      if (!isObject(verified) || typeof verified.success !== 'boolean') throw new Error('upstream')
      if (!verified.success || verified.hostname !== new URL(settings.origin).hostname || verified.action !== 'subscribe')
        return finish(403, 'verification_rejected')

      stage = 'brevo'
      const brevoHeaders = { 'api-key': secrets.brevo, accept: 'application/json', 'content-type': 'application/json' }
      const contactUrl = `https://api.brevo.com/v3/contacts/${encodeURIComponent(input.email)}?identifierType=email_id`
      const call = (url, options = {}) => {
        signal.throwIfAborted()
        return dependencies.fetch(url, { headers: brevoHeaders, redirect: 'error', signal, ...options })
      }
      const lookup = async () => {
        const result = await call(contactUrl)
        if (result.status === 404) return null
        if (result.status !== 200) throw new Error('upstream')
        const data = await result.json()
        if (!isObject(data) || typeof data.emailBlacklisted !== 'boolean' || !ids(data.listIds) ||
            (data.listUnsubscribed !== undefined && !ids(data.listUnsubscribed))) throw new Error('upstream')
        return data
      }
      const existing = async data => {
        if (data.emailBlacklisted || data.listUnsubscribed?.includes(settings.listId) || data.listIds.includes(settings.listId)) return false
        // Account consent groups need an explicit mapping before adding eligible contacts.
        if (data.consentGroups !== undefined) throw new Error('unsupported_account_configuration')
        const saved = await call(contactUrl, { method: 'PUT', body: JSON.stringify({ listIds: [settings.listId] }) })
        if (saved.status !== 204) throw new Error('upstream')
        return true
      }
      let registered = false
      const contact = await lookup()
      if (contact) registered = await existing(contact)
      else {
        const saved = await call('https://api.brevo.com/v3/contacts', {
          method: 'POST', body: JSON.stringify({ email: input.email, listIds: [settings.listId], updateEnabled: false }),
        })
        if (saved.status !== 201) {
          // A concurrent create is the only write failure we recover in this request.
          if (saved.status !== 400 || (await saved.json())?.code !== 'duplicate_parameter') throw new Error('upstream')
          const raced = await lookup()
          if (!raced) throw new Error('upstream')
          registered = await existing(raced)
        } else registered = true
      }
      if (registered && dependencies.meta) {
        const budget = Math.min(1500, (context?.getRemainingTimeInMillis?.() ?? 15000) - 1000)
        if (budget > 0) try {
          const trackingSignal = AbortSignal.timeout(budget)
          const config = await dependencies.meta.config(trackingSignal)
          if (config.mode !== 'off' && config.leadEnabled) {
            const payload = metaApi.buildEvent('Lead', settings.environment, {
              email: input.email, ip: event.requestContext?.http?.sourceIp, agent: headers['user-agent'],
              fbc: metaApi.readCookie(event.cookies || (headers.cookie ? [headers.cookie] : []), metaApi.cookieName(settings.environment)),
            })
            await dependencies.meta.send(payload, config, trackingSignal, input.email)
          }
        } catch { dependencies.meta.failure() }
      }
      return finish(200, 'accepted')
    } catch { return finish(503, `${stage}_failed`) }
  }
}

function createSecretLoader(client, Command, names) {
  let cached, expires = 0
  return async signal => {
    if (cached && Date.now() < expires) return cached
    const entries = await Promise.all(Object.entries(names).map(async ([key, Name]) => {
      const result = await client.send(new Command({ Name, WithDecryption: true }), { abortSignal: signal })
      if (!result.Parameter?.Value) throw new Error('missing_secret')
      return [key, result.Parameter.Value]
    }))
    cached = Object.fromEntries(entries)
    expires = Date.now() + 60000
    return cached
  }
}

let runtimeHandler
exports.handler = async (event, context) => {
  if (!runtimeHandler) {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm')
    runtimeHandler = createHandler({
      enabled: process.env.SIGNUP_ENABLED === 'true', origin: process.env.ALLOWED_ORIGIN,
      listId: Number(process.env.BREVO_LIST_ID), environment: process.env.META_ENVIRONMENT,
    }, {
      fetch,
      meta: metaApi.createRuntime(process.env.META_ENVIRONMENT, { queueUrl: process.env.META_QUEUE_URL }),
      secrets: createSecretLoader(new SSMClient({ maxAttempts: 1 }), GetParameterCommand, {
        turnstile: process.env.TURNSTILE_PARAMETER, brevo: process.env.BREVO_PARAMETER,
      }),
      log: event => console.info(JSON.stringify(event)),
    })
  }
  return runtimeHandler(event, context)
}
exports.createHandler = createHandler
exports.createSecretLoader = createSecretLoader
