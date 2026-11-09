import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { App } from 'aws-cdk-lib'
import { Template } from 'aws-cdk-lib/assertions'
import { Signup } from '../lib/signup-stack.js'
import { Admin } from '../lib/admin-stack.js'
import { Access } from '../lib/access.js'
import { config } from '../lib/config.js'
const require = createRequire(import.meta.url)
const { createStore, createService, createHandler, sourceQuery } = require('../lambda/admin.cjs')
const auth = require('../lambda/admin-auth.cjs')
const credentials = 'Basic ' + Buffer.from('admin:fixture-password-not-live').toString('base64')
const digest = createHash('sha256').update(credentials).digest('hex')
const conditional = () => Object.assign(Error('condition'), { name: 'ConditionalCheckFailedException' })
async function finish(f: ReturnType<typeof fixture>) {
  for (let n = 0; n < 100; n++) {
    const result = await f.service().ensure('production')
    if (result.state === 'ready') return result
  }
  assert.fail('refresh did not finish')
}
const archived = (f: ReturnType<typeof fixture>) => [...f.items.values()].filter(x => x.pk.S.startsWith('history#'))
function fixture() {
  let time = Date.parse('2026-11-08T18:00:00Z'), queryCalls = 0, queueCalls = 0, fail = false, loseReply = false
  const items = new Map<string, any>(), operations: any[] = [], ranges: number[][] = []
  const id = (k: any) => k.pk.S + '/' + k.sk.S
  const copy = (x: any) => x === undefined ? undefined : structuredClone(x)
  const request = async (operation: string, input: any): Promise<any> => {
    operations.push([operation, copy(input)])
    if (operation === 'GetItem') return { Item: copy(items.get(id(input.Key))) }
    if (operation === 'Query') return { Items: [...items.values()].filter(x => x.pk.S === input.ExpressionAttributeValues[':pk'].S).map(copy) }
    if (operation === 'UpdateItem') {
      const old = items.get(id(input.Key)), values = input.ExpressionAttributeValues
      if (old && Number(old.leaseUntil.N) >= Number(values[':now'].N)) throw conditional()
      items.set(id(input.Key), { ...input.Key, owner: values[':owner'], leaseUntil: values[':until'] }); return {}
    }
    if (operation === 'DeleteItem') {
      if (items.get(id(input.Key))?.owner.S !== input.ExpressionAttributeValues[':owner'].S) throw conditional()
      items.delete(id(input.Key)); return {}
    }
    if (operation === 'TransactWriteItems') {
      const c = input.TransactItems[0].ConditionCheck, lock = items.get(id(c.Key))
      if (lock?.owner.S !== c.ExpressionAttributeValues[':owner'].S || Number(lock.leaseUntil.N) <= Number(c.ExpressionAttributeValues[':now'].N)) throw conditional()
      for (const a of input.TransactItems.slice(1)) {
        if (a.Put) items.set(id(a.Put.Item), copy(a.Put.Item))
        if (a.Delete) items.delete(id(a.Delete.Key))
      }
      if (loseReply) { loseReply = false; throw Error('response lost after committed transaction') }
      return {}
    }
    throw Error(operation)
  }
  const store = createStore(request, 'cache', () => time)
  const event = (name: string, hoursAgo: number, env = 'production') => ({ event_id: { S: 'ignored-id' }, event_name: { S: name }, environment: { S: env }, event_time: { N: String(Math.floor(time / 1000 - hoursAgo * 3600)) } })
  let source = [event('ViewContent', 2), event('Lead', 1)]
  const service = () => createService({ store, now: () => time,
    query: async (_env: string, cursor: any, from: number, through: number) => {
      queryCalls++; ranges.push([from, through]); if (fail) throw Error('query failed')
      const matches = source.filter(item => Number(item.event_time.N) >= from && Number(item.event_time.N) <= through)
      return cursor ? { Items: matches.slice(1) } : { Items: matches.slice(0, 1), ...(matches.length > 1 ? { LastEvaluatedKey: { event_id: { S: 'page1' } } } : {}) }
    },
    queue: async () => { queueCalls++; return { visible: 0, inFlight: 0, delayed: 0 } },
  })
  return { store, service, operations, items, ranges, now: () => time, advance: (ms: number) => { time += ms }, calls: () => ({ queryCalls, queueCalls }), fail: () => { fail = true }, lose: () => { loseReply = true }, setSource: (x: any[]) => { source = x }, event }
}
test('persistent pagination survives a new service instance; cache hits do not read sources or SQS', async () => {
  const f = fixture()
  assert.equal((await f.service().read('production')).state, 'missing')
  assert.equal((await f.service().ensure('production')).state, 'updating')
  assert.equal((await f.service().read('production')).data, null)
  const result = await f.service().ensure('production')
  assert.equal(result.state, 'ready'); assert.equal(result.data.totalLeads, 1); assert.equal(result.data.totalViews, 1)
  assert.equal(result.data.hours.length, 2)
  await f.service().ensure('production'); await f.service().read('production')
  assert.deepEqual(f.calls(), { queryCalls: 2, queueCalls: 1 })
  assert.equal((await f.service().read('beta')).data, null)
  const writes = f.operations.filter(([op]) => ['UpdateItem', 'DeleteItem', 'TransactWriteItems'].includes(op))
  assert.ok(writes.every(([, r]) => r.TableName === 'cache' || r.TransactItems.every((x: any) => Object.values(x).every((v: any) => v.TableName === 'cache'))))
})
test('mutex contention, lease expiry, stale-owner fencing, and conditional release', async () => {
  const f = fixture()
  assert.equal(await f.store.acquire('old'), true)
  assert.equal(f.operations.at(-1)[1].ExpressionAttributeNames['#owner'], 'owner')
  assert.match(f.operations.at(-1)[1].UpdateExpression, /SET #owner =/)
  assert.equal((await f.service().ensure('production')).state, 'waiting')
  assert.deepEqual(f.calls(), { queryCalls: 0, queueCalls: 0 })
  f.advance(45001)
  assert.equal(await f.store.acquire('new'), true)
  await assert.rejects(f.store.commit('old', [['bad', 'state', {}]]))
  await f.store.release('old')
  assert.equal(await f.store.acquire('third'), false)
  await f.store.release('new')
  assert.equal(await f.store.acquire('third'), true)
})
test('lost checkpoint response resumes without applying a source page twice', async () => {
  const f = fixture()
  // Prime SQS, then lose the page transaction response rather than the queue write.
  await f.store.acquire('seed')
  await f.store.commit('seed', [['dlq#production', 'state', { schema: 3, freshUntil: f.now() + 60000, visible: 0, inFlight: 0, delayed: 0 }]])
  await f.store.release('seed')
  f.lose()
  await assert.rejects(f.service().ensure('production'))
  const result = await f.service().ensure('production')
  assert.equal(result.data.totalViews, 1); assert.equal(result.data.totalLeads, 1)
  assert.equal(f.calls().queryCalls, 2)
})
test('stale query failure retains last complete generation; cache loss is not reported as zero', async () => {
  const f = fixture()
  await f.service().ensure('production'); const good = await f.service().ensure('production')
  f.advance(60001); f.fail()
  await assert.rejects(f.service().ensure('production'))
  const stale = await f.service().read('production')
  assert.equal(stale.state, 'stale'); assert.equal(stale.data.generation, good.data.generation)
  for (const k of f.items.keys()) if (k.startsWith('history#')) { f.items.delete(k); break }
  assert.equal((await f.service().read('production')).state, 'missing')
})
test('invalid events are excluded; zero rows is a complete empty result', async () => {
  const f = fixture()
  f.setSource([f.event('Lead', -3), f.event('Lead', 1, 'beta'), f.event('Other', 1)])
  await f.service().ensure('production'); const result = await f.service().ensure('production')
  assert.equal(result.data.totalLeads, 0); assert.equal(result.data.totalViews, 0); assert.deepEqual(result.data.hours, [])
})
test('API authenticates cached reads and origin requests; restricts writes to same-origin JSON', async () => {
  let calls = 0
  const service = { read: async () => { calls++; return { state: 'ready' } }, ensure: async () => { calls++; return { state: 'updating' } } }
  const handler = createHandler(service, async () => digest)
  const event = (method = 'GET', path = '/api/metrics', headers: any = {}) => ({ requestContext: { http: { method } }, rawPath: path, queryStringParameters: { environment: 'production' }, headers })
  assert.equal((await handler(event())).statusCode, 401)
  assert.equal((await handler(event('GET', '/api/metrics', { authorization: 'Basic wrong' }))).statusCode, 401)
  assert.equal(calls, 0)
  assert.equal((await handler(event('GET', '/api/metrics', { authorization: credentials }))).statusCode, 200)
  const post = { ...event('POST', '/api/rollups/ensure', { authorization: credentials, origin: 'https://evil.test', 'content-type': 'application/json' }), body: '{"environment":"production"}' }
  assert.equal((await handler(post)).statusCode, 403)
  post.headers.origin = 'https://admin.flatgirl.net'
  assert.equal((await handler(post)).statusCode, 202)
  assert.equal((await handler({ ...post, body: '{"environment":"production","table":"private"}' })).statusCode, 400)
  assert.equal((await createHandler(service, async () => { throw Error('SSM') })(event('GET', '/api/metrics', { authorization: credentials }))).statusCode, 503)
})
test('edge protects cached assets, preserves API Authorization, strips it for S3, and rotates', async () => {
  const edge = auth.createEdge({ read: async () => digest })
  const event = (uri: string, header?: string) => ({ Records: [{ cf: { request: { uri, headers: { host: [{ value: 'admin.flatgirl.net' }], ...(header ? { authorization: [{ value: header }] } : {}) } } } }] })
  for (const path of ['/', '/_nuxt/app.js', '/api/metrics']) assert.equal((await edge(event(path))).status, '401')
  assert.equal((await edge(event('/_nuxt/app.js', credentials))).headers.authorization, undefined)
  assert.equal((await edge(event('/api/metrics', credentials))).headers.authorization[0].value, credentials)
  let time = 0, reads = 0
  const reader = auth.credentialReader({ now: () => time, read: async () => { if (++reads > 1) throw Error('SSM'); return digest } })
  await reader(); await reader(); assert.equal(reads, 1); time = 60001; await assert.rejects(reader())
})
test('admin infrastructure is independent; runtime writes only cache and logs', () => {
  const p = config({ account: '111111111111', region: 'us-east-1', hostedZoneId: 'ZEXAMPLE', domain: 'flatgirl.net', operatorPrincipalArn: null, betaEnabled: true, productionNoindex: true })
  const app = new App(), access = new Access(app, p), admin = new Admin(app, p)
  const a = Template.fromStack(admin)
  a.resourceCountIs('AWS::DynamoDB::Table', 1)
  a.hasResourceProperties('AWS::DynamoDB::Table', { TableName: 'flat-girl-admin-cache', TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true } })
  a.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'admin.flatgirl.net' })
  const distribution: any = Object.values(a.findResources('AWS::CloudFront::Distribution'))[0]
  assert.equal(distribution.Properties.DistributionConfig.CacheBehaviors[0].CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad')
  assert.equal(admin.dependencies.length, 0)
  const policies = Template.fromStack(access).findResources('AWS::IAM::Policy')
  const runtime: any = Object.entries(policies).find(([id]) => id.startsWith('AdminRuntimeDefaultPolicy'))?.[1]
  assert.ok(runtime)
  for (const s of runtime.Properties.PolicyDocument.Statement) {
    for (const action of Array.isArray(s.Action) ? s.Action : [s.Action]) {
      if (/:(Put|Update|Delete|ConditionCheck)/.test(action) && !action.startsWith('logs:')) assert.equal(s.Resource, 'arn:aws:dynamodb:us-east-1:111111111111:table/flat-girl-admin-cache')
    }
  }
  const query = runtime.Properties.PolicyDocument.Statement.find((s: any) => s.Action === 'dynamodb:Query')
  assert.equal(query.Condition.StringEquals['dynamodb:Select'], 'SPECIFIC_ATTRIBUTES')
  assert.deepEqual(query.Condition['ForAllValues:StringEquals']['dynamodb:Attributes'], ['event_id', 'event_name', 'event_time', 'environment', 'client_ip_address', 'client_user_agent'])
  assert.ok(!JSON.stringify(query).includes('email'))
  assert.deepEqual(query.Resource, ['beta', 'production'].map(env => `arn:aws:dynamodb:us-east-1:111111111111:table/flat-girl-${env}-events/index/environment-time`))
  assert.ok(!JSON.stringify(runtime).includes('dynamodb:Scan'))
})

test('unique views deduplicate across pages/hours/days, hide fingerprints, and preserve raw counts', async () => {
  const f = fixture()
  const identified = (hours: number, agent = 'Browser A') => ({ ...f.event('ViewContent', hours), client_ip_address: { S: '192.0.2.1' }, client_user_agent: { S: agent } })
  f.setSource([identified(1), identified(1), identified(2), identified(13), identified(2, 'Browser B'), f.event('ViewContent', 3), f.event('Lead', 1)])
  await f.service().ensure('production'); const r = await f.service().ensure('production')
  assert.equal(r.data.totalViews, 6); assert.equal(r.data.totalLeads, 1)
  assert.equal(r.data.totalUniqueViews, 2); assert.equal(r.data.unidentifiedViews, 1)
  assert.equal(r.data.hours.reduce((n: number, h: number[]) => n + h[3], 0), 4)
  assert.deepEqual(r.data.uniqueDays.map((d: any[]) => d[1]), [1, 2])
  assert.deepEqual(r.data.uniqueDays.map((d: any[]) => d[2]), [1, 2])
  assert.equal(r.data.uniqueWeeks[0][1], 2)
  assert.ok(!JSON.stringify(r).includes('identities'))
  assert.ok(!JSON.stringify([...f.items.values()]).includes('192.0.2.1'))
  assert.ok(!JSON.stringify([...f.items.values()]).includes('Browser A'))
  assert.ok(![...f.items.values()].some(x => x.pk.S === 'job#production'))
})
test('production cutoff is November 7 at 3 PM Chicago; beta history remains independent', async () => {
  const f = fixture(), start = Date.parse('2026-11-07T21:00:00Z') / 1000
  const at = (name: string, seconds: number) => ({ ...f.event(name, 0), event_time: { N: String(seconds) } })
  f.setSource([at('ViewContent', start - 1), at('Lead', start - 1), at('ViewContent', start), at('Lead', start)])
  await f.service().ensure('production'); const r = await f.service().ensure('production')
  assert.equal(r.data.totalViews, 1); assert.equal(r.data.totalLeads, 1); assert.equal(r.data.coverageStart, start)
})
test('fingerprint canonicalizes IPv6 and uses a private archive secret; missing identity is not invented', () => {
  const { fingerprint, summarize } = require('../lambda/admin-unique.cjs')
  const item = (ip: string) => ({ client_ip_address: { S: ip }, client_user_agent: { S: 'Browser' } })
  const salt = '11'.repeat(32)
  assert.equal(fingerprint(item('2001:db8::1'), salt), fingerprint(item('2001:0db8:0:0:0:0:0:1'), salt))
  assert.notEqual(fingerprint(item('192.0.2.1'), salt), fingerprint(item('192.0.2.1'), '22'.repeat(32)))
  assert.equal(fingerprint({}, salt), null)
  const a = Date.parse('2026-11-09T05:00:00Z') / 1000, b = a + 3600
  const r = summarize([{ hours: [[a, 1, 0], [b, 1, 0]], identities: { same: [a, b] } }])
  assert.equal(r.totalUniqueViews, 1); assert.deepEqual(r.uniqueWeeks.map((w: any[]) => w[1]), [1, 1])
})

test('refresh after an hour preserves history and queries only the previously open hour onward', async () => {
  const f = fixture(), start = f.now() / 1000
  const history = f.event('ViewContent', 2), live = f.event('ViewContent', 0)
  f.setSource([history, live]); await finish(f)
  const frozen = structuredClone(archived(f))
  f.advance(3600000)
  // Historical source changes are ignored; the prior partial hour is finalized once.
  f.setSource([live, f.event('Lead', 0.5), f.event('ViewContent', 0)])
  const updated = await finish(f)
  assert.equal(updated.data.totalViews, 3); assert.equal(updated.data.totalLeads, 1)
  assert.ok(f.ranges.slice(2).every(([from]) => from === start))
  for (const item of frozen) assert.deepEqual(f.items.get(item.pk.S + '/' + item.sk.S), item)
  const sealed = structuredClone(archived(f)), before = f.ranges.length
  f.advance(60001); await finish(f)
  assert.ok(f.ranges.slice(before).every(([from]) => from === start + 3600))
  assert.deepEqual(archived(f), sealed)
  assert.ok(archived(f).every(item => !item.ttl))
})
test('same-hour refresh replaces partial counts and deduplicates visitors across frozen history', async () => {
  const f = fixture()
  const person = (hours: number) => ({ ...f.event('ViewContent', hours), client_ip_address: { S: '192.0.2.9' }, client_user_agent: { S: 'Browser' } })
  const past = person(1), live = person(0)
  f.setSource([past, live]); await finish(f)
  const frozen = structuredClone(archived(f))
  f.advance(60001); f.setSource([past, live, person(0), f.event('Lead', 0)])
  const r = await finish(f)
  assert.equal(r.data.totalViews, 3); assert.equal(r.data.totalUniqueViews, 1); assert.equal(r.data.totalLeads, 1)
  assert.equal(r.data.hours.at(-1)[1], 2); assert.equal(r.data.hours.at(-1)[3], 1)
  assert.deepEqual(archived(f), frozen)
  const head = await f.store.get('head#production')
  assert.ok(head.salt); assert.ok(!JSON.stringify(r).includes(head.salt))
  assert.ok(!JSON.stringify(r).includes('identities'))
})
test('expired live cache after a long absence reuses durable history and catches up missing hours', async () => {
  const f = fixture(), start = f.now() / 1000
  const past = f.event('ViewContent', 2), live = f.event('Lead', 0)
  f.setSource([past, live]); await finish(f)
  const frozen = structuredClone(archived(f)), before = f.ranges.length
  f.advance(8 * 86400000)
  for (const [key, item] of f.items) if (item.ttl && Number(item.ttl.N) < f.now() / 1000) f.items.delete(key)
  f.setSource([live, f.event('ViewContent', 24), f.event('Lead', 0)])
  const r = await finish(f)
  assert.equal(r.data.totalViews, 2); assert.equal(r.data.totalLeads, 2)
  assert.ok(f.ranges.slice(before).every(([from]) => from === start))
  for (const item of frozen) assert.deepEqual(f.items.get(item.pk.S + '/' + item.sk.S), item)
})
test('staged closed hours stay invisible and a lost checkpoint resumes after more than an hour', async () => {
  const f = fixture()
  const past = f.event('ViewContent', 2), live = f.event('Lead', 0)
  f.setSource([past, live]); const initial = await finish(f)
  f.advance(3600000); f.setSource([live, f.event('ViewContent', 0)])
  await f.store.acquire('seed')
  await f.store.commit('seed', [['dlq#production', 'state', { schema: 3, freshUntil: f.now() + 60000 }]])
  await f.store.release('seed')
  f.lose(); await assert.rejects(f.service().ensure('production'))
  const stale = await f.service().read('production')
  assert.deepEqual(stale.data, initial.data)
  const job = await f.store.get('job#production')
  f.advance(2 * 3600000)
  const completed = await f.service().ensure('production')
  assert.equal(completed.data.generation, job.generation)
  assert.equal(completed.state, 'stale')
  assert.equal(completed.data.totalLeads, 1); assert.equal(completed.data.totalViews, 2)
  const fresh = await finish(f)
  assert.equal(fresh.data.totalLeads, 1); assert.equal(fresh.data.totalViews, 2)
})
test('source query uses an indexed inclusive time range and preserves pagination', () => {
  const cursor = { event_id: { S: 'next' } }, q = sourceQuery('production', cursor, 100, 200)
  assert.equal(q.IndexName, 'environment-time'); assert.equal(q.Limit, 50)
  assert.match(q.KeyConditionExpression, /BETWEEN :from AND :through/)
  assert.deepEqual(q.ExpressionAttributeValues, { ':env': { S: 'production' }, ':from': { N: '100' }, ':through': { N: '200' } })
  assert.deepEqual(q.ExclusiveStartKey, cursor)
  assert.equal(q.ConsistentRead, undefined)
})
test('both source tables have a projected time index without changing their primary key', () => {
  const p = config({ account: '111111111111', region: 'us-east-1', hostedZoneId: 'ZEXAMPLE', domain: 'flatgirl.net', operatorPrincipalArn: null, betaEnabled: true, productionNoindex: true })
  for (const env of ['beta', 'production'] as const) {
    const template = Template.fromStack(new Signup(new App(), p, env, { turnstileSiteKey: '', beta: { enabled: false, listId: 5, rateLimit: 5, burstLimit: 10 }, production: { enabled: false, listId: 4, rateLimit: 5, burstLimit: 10 } }))
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'event_id', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [{ IndexName: 'environment-time',
        KeySchema: [{ AttributeName: 'environment', KeyType: 'HASH' }, { AttributeName: 'event_time', KeyType: 'RANGE' }],
        Projection: { ProjectionType: 'INCLUDE', NonKeyAttributes: ['event_name', 'client_ip_address', 'client_user_agent'] } }],
    })
  }
})
