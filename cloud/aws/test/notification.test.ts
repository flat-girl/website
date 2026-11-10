import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const { createHandler, createNotifier, notificationMessage } = createRequire(import.meta.url)('../lambda/notification.cjs')
class Command { constructor(public input: any) {} }
const root = '<real-delivered-message@email.amazonses.com>'

test('raw SES email preserves exact content and threads on the delivered anchor', () => {
  const raw = notificationMessage('reader@example.com', root, 'production').toString()
  const [headers, body] = raw.split('\r\n\r\n')
  for (const header of ['From: high@flatgirl.net', 'To: high@flatgirl.net', 'Subject: New Flat Girl Subscriber!',
    `In-Reply-To: ${root}`, `References: ${root}`]) assert.ok(headers.split('\r\n').includes(header))
  assert.equal(Buffer.from(body, 'base64').toString(), 'Customer reader@example.com subscribed to email updates off of the flatgirl.net site!')
  assert.ok(!headers.includes('Message-ID:'))
  assert.ok(notificationMessage('reader@example.com', root, 'beta').toString().includes('Subject: [Beta] New Flat Girl Subscriber!'))
  for (const bad of ['', undefined, 'fake', '<x@y>\r\nBcc: victim@example.com', '<x@y> <z@y>', `<${'x'.repeat(255)}@y>`])
    assert.throws(() => notificationMessage('reader@example.com', bad, 'production'))
})

test('notifier uses only the fixed owner destination, forwards abort signal and caches settings', async () => {
  let reads = 0
  const calls: any[] = [], signal = new AbortController().signal
  const notify = createNotifier({ send: async () => { reads++; return { Parameter: { Value: JSON.stringify({ enabled: true, threadMessageId: root }) } } } }, Command,
    { send: async (command: Command, options: any) => { calls.push({ ...command.input, options }); return { MessageId: 'sent-id' } } }, Command, '/settings', 'production')
  assert.equal(await notify('first@example.com', signal), true)
  await notify('second@example.com', signal)
  assert.equal(reads, 1); assert.equal(calls.length, 2)
  assert.equal(calls[0].Source, 'high@flatgirl.net')
  assert.deepEqual(calls[0].Destinations, ['high@flatgirl.net'])
  assert.equal(calls[0].options.abortSignal, signal)
})

test('missing/disabled settings do not send; invalid settings and SES errors fail for queue retry', async () => {
  for (const config of [null, { enabled: false }, { enabled: true, threadMessageId: 'invalid' }, { enabled: 'true' }]) {
    let sends = 0
    const notify = createNotifier({ send: async () => {
      if (config === null) throw Object.assign(Error(), { name: 'ParameterNotFound' })
      return { Parameter: { Value: JSON.stringify(config) } }
    } }, Command, { send: async () => { sends++ } }, Command, '/settings', 'production')
    if (config === null || config.enabled === false) assert.equal(await notify('a@example.com'), false)
    else await assert.rejects(() => notify('a@example.com'))
    assert.equal(sends, 0)
  }
  const failing = createNotifier({ send: async () => ({ Parameter: { Value: JSON.stringify({ enabled: true, threadMessageId: root }) } }) },
    Command, { send: async () => { throw Error('SES unavailable') } }, Command, '/settings', 'production')
  await assert.rejects(() => failing('a@example.com'))
})

test('worker retries only failed queue records, validates environment and never logs addresses', async () => {
  const logs: any[] = [], sent: string[] = []
  const handler = createHandler('production', async (email: string) => {
    if (email === 'fail@example.com') throw Error(email)
    sent.push(email); return true
  }, (value: any) => logs.push(value))
  const record = (id: string, email: string, environment = 'production') => ({ messageId: id, body: JSON.stringify({ schema: 1, email, environment }) })
  const result = await handler({ Records: [record('1', 'ok@example.com'), record('2', 'fail@example.com'),
    record('3', 'beta@example.com', 'beta'), record('4', 'invalid\r\n@example.com'), { messageId: '5', body: '{' }] })
  assert.deepEqual(result.batchItemFailures, ['2','3','4','5'].map(itemIdentifier => ({ itemIdentifier })))
  assert.deepEqual(sent, ['ok@example.com'])
  assert.ok(!JSON.stringify(logs).includes('@'))
})

test('signup runtime contains no SES client or delivery operation', () => {
  const source = readFileSync(new URL('../lambda/signup.cjs', import.meta.url), 'utf8')
  assert.ok(!source.includes('SESClient')); assert.ok(!source.includes('SendRawEmail'))
  assert.ok(source.includes('NOTIFICATION_QUEUE_URL'))
})
