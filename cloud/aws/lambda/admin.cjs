const { randomUUID, randomBytes } = require('node:crypto')
const auth = typeof __adminAuth === 'undefined' ? require('./admin-auth.cjs') : __adminAuth
const unique = typeof __adminUnique === 'undefined' ? require('./admin-unique.cjs') : __adminUnique
const FRESH = 60000, LEASE = 45000, RETAIN = 7 * 86400, SCHEMA = 3
const PRODUCTION_START = Date.parse('2026-11-07T21:00:00Z') / 1000
const key = (pk, sk = 'state') => ({ pk: { S: pk }, sk: { S: sk } })
const unpack = item => item ? JSON.parse(item.data.S) : undefined
const packed = (pk, sk, data, now, permanent) => ({ ...key(pk, sk), data: { S: JSON.stringify(data) }, ...(permanent ? {} : { ttl: { N: String(Math.floor(now / 1000) + RETAIN) } }) })
function createStore(request, table, now = Date.now) {
  const get = async (pk, sk = 'state') => unpack((await request('GetItem', { TableName: table, Key: key(pk, sk), ConsistentRead: true })).Item)
  const put = (pk, sk, data, permanent) => ({ Put: { TableName: table, Item: packed(pk, sk, data, now(), permanent) } })
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
      ...entries.map(([pk, sk, value, permanent]) => put(pk, sk, value, permanent)),
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
// Existing source attributes allow DynamoDB to backfill the index without rewriting events.
function sourceQuery(env, cursor, from, through) {
  return { TableName: `flat-girl-${env}-events`, IndexName: 'environment-time', Limit: 50,
    Select: 'SPECIFIC_ATTRIBUTES', ProjectionExpression: 'event_id, event_name, event_time, environment, client_ip_address, client_user_agent',
    KeyConditionExpression: '#env = :env AND #time BETWEEN :from AND :through',
    ExpressionAttributeNames: { '#env': 'environment', '#time': 'event_time' },
    ExpressionAttributeValues: { ':env': { S: env }, ':from': { N: String(from) }, ':through': { N: String(through) } },
    ...(cursor ? { ExclusiveStartKey: cursor } : {}) }
}
function createService(deps) {
  const { store, query, queue } = deps, now = deps.now || Date.now
  const fresh = value => value?.schema === SCHEMA && value.freshUntil > now()
  async function load(env) {
    const [head, dlq] = await Promise.all([store.get(`head#${env}`), store.get(`dlq#${env}`)])
    let data = null, historyValid = false
    if (head?.schema === SCHEMA) {
      const [archived, live] = await Promise.all([store.days(`history#${env}#${head.archive}`), store.days(`data#${env}#${head.generation}`)])
      // New closed hours stay invisible until their checkpoint and manifest publish atomically.
      const history = archived.filter(chunk => chunk.revision <= head.revision)
      historyValid = history.length === head.historyCount
      if (historyValid && live.length === head.dayCount) {
        const { salt, archive, revision, historyCount, historyViews, historyLeads, ...publicHead } = head
        data = { ...publicHead, ...unique.summarize([...history, ...live]) }
      }
    }
    return { head, historyValid, result: {
      state: data && fresh(data) && fresh(dlq) ? 'ready' : (data ? 'stale' : 'missing'), environment: env, data,
      dlq: dlq ? { ...dlq, stale: !fresh(dlq) } : null,
    } }
  }
  const read = async env => (await load(env)).result
  async function ensure(env) {
    let current = await read(env)
    if (current.state === 'ready') return current
    const owner = randomUUID()
    if (!await store.acquire(owner)) return { state: 'waiting', retryAfterMs: 1500 }
    try {
      const loaded = await load(env)
      current = loaded.result
      if (current.state === 'ready') return current
      if (!fresh(current.dlq)) {
        try {
          const counts = await queue(env)
          await store.commit(owner, [[`dlq#${env}`, 'state', { schema: SCHEMA, ...counts, checkedAt: now(), freshUntil: now() + FRESH, error: false }]])
        } catch {
          await store.commit(owner, [[`dlq#${env}`, 'state', { ...current.dlq, schema: SCHEMA, error: true, freshUntil: now() + FRESH }]])
        }
      }
      if (fresh(current.data)) return await read(env)
      const previous = loaded.historyValid ? loaded.head : null
      let job = await store.get(`job#${env}`)
      if (!job || job.schema !== SCHEMA || job.baseGeneration !== (previous?.generation || null)) {
        const startedAt = now()
        job = { schema: SCHEMA, salt: previous?.salt || randomBytes(32).toString('hex'),
          archive: previous?.archive || randomUUID(), revision: (previous?.revision || 0) + 1,
          baseGeneration: previous?.generation || null, generation: randomUUID(), startedAt,
          from: previous?.openHour ?? (env === 'production' ? PRODUCTION_START : 0),
          through: Math.floor(startedAt / 1000), openHour: Math.floor(startedAt / 3600000) * 3600,
          cursor: null, pages: 0, totalViews: 0, totalLeads: 0, closedViews: 0, closedLeads: 0,
          firstEvent: previous?.firstEvent ?? null, dayCount: 0, closedCount: 0 }
      }
      // Query only the previously open hour through this refresh. Never read sealed source history.
      // Durable jobs resume even after a long absence; restarting could strand partially staged hours.
      const page = await query(env, job.cursor, job.from, job.through)
      const chunks = new Map()
      for (const item of page.Items || []) {
        const name = item.event_name?.S, time = Number(item.event_time?.N)
        if (item.environment?.S !== env || !['Lead', 'ViewContent'].includes(name) || !Number.isSafeInteger(time) || time < job.from || time > job.through) continue
        const hour = Math.floor(time / 3600) * 3600, closed = hour < job.openHour
        const person = name === 'ViewContent' ? unique.fingerprint(item, job.salt) : null
        const id = String(hour).padStart(12, '0') + '#' + (person ? person.slice(0, 2) : 'raw')
        const pk = closed ? `history#${env}#${job.archive}` : `data#${env}#${job.generation}`
        if (!chunks.has(id)) {
          const old = await store.get(pk, id)
          chunks.set(id, { pk, closed, data: old || { revision: job.revision, hours: [[hour, 0, 0, 0]], identities: {} } })
          if (!old) { if (closed) job.closedCount++; else job.dayCount++ }
        }
        const { data } = chunks.get(id), bucket = data.hours[0]
        bucket[name === 'Lead' ? 2 : 1]++
        if (person) data.identities[person] = [hour]
        else if (name === 'ViewContent') bucket[3]++
        if (name === 'Lead') { job.totalLeads++; if (closed) job.closedLeads++ }
        else { job.totalViews++; if (closed) job.closedViews++ }
        job.firstEvent = job.firstEvent === null ? time : Math.min(time, job.firstEvent)
      }
      job.pages++; job.cursor = page.LastEvaluatedKey || null
      const entries = [...chunks].map(([id, { pk, closed, data }]) => [pk, id, data, closed])
      if (job.cursor) {
        entries.push([`job#${env}`, 'state', job, true])
        await store.commit(owner, entries)
        return { state: 'updating', pages: job.pages, retryAfterMs: 100 }
      }
      const head = { schema: SCHEMA, generation: job.generation, archive: job.archive, salt: job.salt, revision: job.revision,
        openHour: job.openHour, startedAt: job.startedAt, calculatedAt: job.startedAt, freshUntil: job.startedAt + FRESH,
        coverageStart: env === 'production' ? PRODUCTION_START : job.firstEvent, firstEvent: job.firstEvent,
        totalViews: (previous?.historyViews || 0) + job.totalViews, totalLeads: (previous?.historyLeads || 0) + job.totalLeads,
        historyViews: (previous?.historyViews || 0) + job.closedViews, historyLeads: (previous?.historyLeads || 0) + job.closedLeads,
        historyCount: (previous?.historyCount || 0) + job.closedCount, dayCount: job.dayCount }
      entries.push([`head#${env}`, 'state', head, true])
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
      query: (env, cursor, from, through) => request('Query', sourceQuery(env, cursor, from, through)),
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

exports.sourceQuery = sourceQuery
