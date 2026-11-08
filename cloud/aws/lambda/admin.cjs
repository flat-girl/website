const { randomUUID, randomBytes } = require('node:crypto')
const auth = typeof __adminAuth === 'undefined' ? require('./admin-auth.cjs') : __adminAuth
const unique = typeof __adminUnique === 'undefined' ? require('./admin-unique.cjs') : __adminUnique
const FRESH = 60000, LEASE = 45000, RETAIN = 7 * 86400, SCHEMA = 2
const PRODUCTION_START = Date.parse('2026-11-07T21:00:00Z') / 1000
const key = (pk, sk = 'state') => ({ pk: { S: pk }, sk: { S: sk } })
const unpack = item => item ? JSON.parse(item.data.S) : undefined
const packed = (pk, sk, data, now) => ({ ...key(pk, sk), data: { S: JSON.stringify(data) }, ttl: { N: String(Math.floor(now / 1000) + RETAIN) } })
function createStore(request, table, now = Date.now) {
  const get = async (pk, sk = 'state') => unpack((await request('GetItem', { TableName: table, Key: key(pk, sk), ConsistentRead: true })).Item)
  const put = (pk, sk, data) => ({ Put: { TableName: table, Item: packed(pk, sk, data, now()) } })
  return {
    get,
    async acquire(owner) {
      try {
        await request('UpdateItem', { TableName: table, Key: key('mutex'),
          UpdateExpression: 'SET #owner = :owner, leaseUntil = :until', ExpressionAttributeNames: { '#owner': 'owner' },
          ConditionExpression: 'attribute_not_exists(leaseUntil) OR leaseUntil < :now',
          ExpressionAttributeValues: { ':owner': { S: owner }, ':until': { N: String(now() + LEASE) }, ':now': { N: String(now()) } } })
        return true
      } catch (e) { if (e.name === 'ConditionalCheckFailedException') return false; throw e }
    },
    async release(owner) {
      try { await request('DeleteItem', { TableName: table, Key: key('mutex'), ExpressionAttributeNames: { '#owner': 'owner' }, ConditionExpression: '#owner = :owner', ExpressionAttributeValues: { ':owner': { S: owner } } }) }
      catch (e) { if (e.name !== 'ConditionalCheckFailedException') throw e }
    },
    async commit(owner, entries, removes = []) {
      const actions = [{ ConditionCheck: { TableName: table, Key: key('mutex'), ExpressionAttributeNames: { '#owner': 'owner' }, ConditionExpression: '#owner = :owner AND leaseUntil > :now',
        ExpressionAttributeValues: { ':owner': { S: owner }, ':now': { N: String(now()) } } } },
      ...entries.map(([pk, sk, value]) => put(pk, sk, value)),
      ...removes.map(pk => ({ Delete: { TableName: table, Key: key(pk) } }))]
      await request('TransactWriteItems', { TransactItems: actions, ClientRequestToken: randomUUID() })
    },
    async days(pk) {
      const days = []; let cursor
      do {
        const r = await request('Query', { TableName: table, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': { S: pk } }, ConsistentRead: true, ...(cursor ? { ExclusiveStartKey: cursor } : {}) })
        days.push(...(r.Items || []).map(unpack)); cursor = r.LastEvaluatedKey
      } while (cursor)
      return days
    },
  }
}
function createService(deps) {
  const { store, scan, queue } = deps, now = deps.now || Date.now
  const fresh = value => value?.schema === SCHEMA && value.freshUntil > now()
  async function read(env) {
    const [head, dlq] = await Promise.all([store.get(`head#${env}`), store.get(`dlq#${env}`)])
    let data = null
    if (head?.schema === SCHEMA) {
      const days = await store.days(`data#${env}#${head.generation}`)
      if (days.length === head.dayCount) {
        data = { ...head, ...unique.summarize(days) }
      }
    }
    return { state: data && fresh(data) && fresh(dlq) ? 'ready' : (data ? 'stale' : 'missing'), environment: env, data,
      dlq: dlq ? { ...dlq, stale: !fresh(dlq) } : null }
  }
  async function ensure(env) {
    let current = await read(env)
    if (current.state === 'ready') return current
    const owner = randomUUID()
    if (!await store.acquire(owner)) return { state: 'waiting', retryAfterMs: 1500 }
    try {
      current = await read(env)
      if (current.state === 'ready') return current
      if (!fresh(current.dlq)) {
        try {
          const counts = await queue(env)
          await store.commit(owner, [[`dlq#${env}`, 'state', { schema: SCHEMA, ...counts, checkedAt: now(), freshUntil: now() + FRESH, error: false }]])
        } catch {
          // Cache failures as unavailable, retaining the timestamp of the last successful check.
          await store.commit(owner, [[`dlq#${env}`, 'state', { ...current.dlq, schema: SCHEMA, error: true, freshUntil: now() + FRESH }]])
        }
      }
      if (fresh(current.data)) return await read(env)
      let job = await store.get(`job#${env}`)
      if (!job || job.schema !== SCHEMA || job.startedAt < now() - 3600000) {
        job = { schema: SCHEMA, salt: randomBytes(32).toString('hex'), generation: randomUUID(), startedAt: now(), cursor: null, pages: 0, totalViews: 0, totalLeads: 0, firstEvent: null, dayCount: 0 }
      }
      // One source page per invocation: bounded requests, persisted progress, no background jobs.
      const page = await scan(env, job.cursor)
      const days = new Map()
      for (const item of page.Items || []) {
        const name = item.event_name?.S, time = Number(item.event_time?.N)
        if (item.environment?.S !== env || !['Lead', 'ViewContent'].includes(name) || !Number.isSafeInteger(time) || time < 0 || time * 1000 > now() || (env === 'production' && time < PRODUCTION_START)) continue
        const hour = Math.floor(time / 3600) * 3600
        const person = name === 'ViewContent' ? unique.fingerprint(item, job.salt) : null
        const date = new Date(hour * 1000).toISOString().slice(0, 10) + '#' + (person ? person.slice(0, 2) : 'raw')
        if (!days.has(date)) {
          const old = await store.get(`data#${env}#${job.generation}`, date)
          days.set(date, old || { hours: [], identities: {} }); if (!old) job.dayCount++
        }
        const hours = days.get(date).hours
        let bucket = hours.find(b => b[0] === hour)
        if (!bucket) { bucket = [hour, 0, 0, 0]; hours.push(bucket) }
        bucket[name === 'Lead' ? 2 : 1]++
        if (person) {
          const identities = days.get(date).identities
          identities[person] ||= []
          if (!identities[person].includes(hour)) identities[person].push(hour)
        } else if (name === 'ViewContent') bucket[3]++
        if (name === 'Lead') job.totalLeads++; else job.totalViews++
        job.firstEvent = job.firstEvent === null ? time : Math.min(time, job.firstEvent)
      }
      job.pages++; job.cursor = page.LastEvaluatedKey || null
      const entries = [...days].map(([date, data]) => [`data#${env}#${job.generation}`, date, data])
      if (job.cursor) {
        entries.push([`job#${env}`, 'state', job])
        await store.commit(owner, entries)
        return { state: 'updating', pages: job.pages, retryAfterMs: 100 }
      }
      const head = { schema: SCHEMA, generation: job.generation, startedAt: job.startedAt, calculatedAt: now(), freshUntil: now() + FRESH,
        coverageStart: env === 'production' ? PRODUCTION_START : job.firstEvent, firstEvent: job.firstEvent, totalViews: job.totalViews, totalLeads: job.totalLeads, dayCount: job.dayCount }
      entries.push([`head#${env}`, 'state', head])
      await store.commit(owner, entries, [`job#${env}`])
      return await read(env)
    } finally { await store.release(owner) }
  }
  return { read, ensure }
}
function createHandler(service, readCredential = auth.credentialReader()) {
  return async event => {
    const response = (statusCode, body, extra = {}) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra }, body: JSON.stringify(body) })
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
    const denied = () => response(401, { error: 'Authentication required' }, { 'www-authenticate': 'Basic realm="Flat Girl Admin", charset="UTF-8"' })
    if (!headers.authorization?.startsWith('Basic ')) return denied()
    try { if (!auth.valid(headers.authorization, await readCredential(AbortSignal.timeout(2500)))) return denied() }
    catch { return response(503, { error: 'Authentication unavailable' }) }
    const method = event.requestContext?.http?.method, path = event.rawPath
    try {
      let env
      if (method === 'GET' && path === '/api/metrics') env = event.queryStringParameters?.environment
      else if (method === 'POST' && path === '/api/rollups/ensure') {
        if (headers.origin !== 'https://admin.flatgirl.net' || headers['sec-fetch-site'] && headers['sec-fetch-site'] !== 'same-origin' || !/^application\/json(?:;|$)/i.test(headers['content-type'] || '')) return response(403, { error: 'Same-origin JSON required' })
        if (event.isBase64Encoded || (event.body || '').length > 256) return response(400, { error: 'Invalid request' })
        const body = JSON.parse(event.body || '{}')
        if (!body || Object.keys(body).join(',') !== 'environment') return response(400, { error: 'Invalid request' })
        env = body.environment
      } else return response(404, { error: 'Not found' })
      if (!['production', 'beta'].includes(env)) return response(400, { error: 'Invalid environment' })
      const result = await (method === 'GET' ? service.read(env) : service.ensure(env))
      return response(['waiting', 'updating'].includes(result.state) ? 202 : 200, result)
    } catch (e) {
      if (e instanceof SyntaxError) return response(400, { error: 'Invalid JSON' })
      console.log('admin_metrics_failed', typeof e?.name === 'string' ? e.name : 'Error')
      return response(503, { error: 'Dashboard update unavailable. Previously loaded data is unchanged.' })
    }
  }
}
let handler, invocationSignal
exports.handler = async event => {
  invocationSignal = AbortSignal.timeout(22000)
  if (!handler) {
    const ddb = require('@aws-sdk/client-dynamodb'), sqs = require('@aws-sdk/client-sqs')
    const db = new ddb.DynamoDBClient({ region: 'us-east-1', maxAttempts: 2 })
    const queues = new sqs.SQSClient({ region: 'us-east-1', maxAttempts: 2 })
    const request = (operation, input) => db.send(new ddb[operation + 'Command'](input), { abortSignal: invocationSignal })
    const store = createStore(request, process.env.CACHE_TABLE)
    handler = createHandler(createService({ store,
      scan: (env, cursor) => request('Scan', { TableName: `flat-girl-${env}-events`, Limit: 50,
        Select: 'SPECIFIC_ATTRIBUTES', ProjectionExpression: 'event_id, event_name, event_time, environment, client_ip_address, client_user_agent', ...(cursor ? { ExclusiveStartKey: cursor } : {}) }),
      queue: async env => {
        const r = await queues.send(new sqs.GetQueueAttributesCommand({ QueueUrl: `https://sqs.us-east-1.amazonaws.com/${process.env.ACCOUNT_ID}/flat-girl-${env}-meta-dlq`,
          AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'] }), { abortSignal: AbortSignal.timeout(3000) })
        const [visible, inFlight, delayed] = ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'].map(k => {
          if (!/^\d+$/.test(r.Attributes?.[k] || '')) throw Error('queue_unavailable')
          return Number(r.Attributes[k])
        })
        return { visible, inFlight, delayed }
      },
    }))
  }
  return handler(event)
}
exports.createHandler = createHandler
exports.createService = createService
exports.createStore = createStore
