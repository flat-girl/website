// One-off manual regression against Meta, outside Lambda/SQS. Private inputs arrive on stdin.
const meta = require('../cloud/aws/lambda/meta.cjs')
function regressionFetch(testEventCode, fetcher = fetch) {
  if (typeof testEventCode !== 'string' || !/^TEST[0-9]+$/.test(testEventCode)) throw new Error('Test code required')
  // Extend the shared transport only here; deployed delivery never adds a test code.
  return (url, options) => fetcher(url, { ...options,
    body: JSON.stringify({ ...JSON.parse(options.body), test_event_code: testEventCode }) })
}
async function main() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const item = JSON.parse(input)
  const config = meta.settings(item.config, item.environment)
  const fetcher = regressionFetch(item.testEventCode)
  const event = meta.buildEvent(item.event, item.environment, item.customer || {})
  if (item.send) await meta.deliver(event, config, item.credentials, AbortSignal.timeout(10000), fetcher)
  console.log(JSON.stringify({ event: event.event_name, eventId: event.event_id,
    testEventCode: item.testEventCode, fields: Object.keys(event.user_data), outcome: item.send ? 'delivered' : 'offline' }))
}
exports.regressionFetch = regressionFetch
if (require.main === module) main().catch(() => { console.error('Meta regression check failed; check configuration, credentials and Test Events. No private payload was logged.'); process.exitCode = 1 })
