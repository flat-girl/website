import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { routeCode } from './routes.js'
export type MetaEnvironment = 'beta' | 'production'
export const metaParameters = (env: MetaEnvironment) => ({
  settings: `/flat-girl/meta/${env}/settings`, credentials: `/flat-girl/meta/${env}/credentials`,
})
export const metaQueueName = (env: MetaEnvironment) => `flat-girl-${env}-meta`
export const metaWorkerName = (env: MetaEnvironment) => `flat-girl-${env}-meta-worker`
export const eventTableName = (env: MetaEnvironment) => `flat-girl-${env}-events`
export const edgeName = (env: MetaEnvironment) => `flat-girl-${env}-meta-edge`
export function lambdaCode(file: 'signup' | 'edge' | 'worker', env: MetaEnvironment, queueUrl = ''): string {
  const helper = readFileSync(new URL('../lambda/meta.cjs', import.meta.url), 'utf8')
  const source = readFileSync(new URL(`../lambda/${file === 'worker' ? 'meta-worker' : file}.cjs`, import.meta.url), 'utf8')
  return `const __environment = ${JSON.stringify(env)}; const __queueUrl = ${JSON.stringify(queueUrl)};\nconst __meta = (() => { const exports = {};\n${helper}\nreturn exports; })();\n${source}`
}
export const codeHash = (code: string) => createHash('sha256').update(code).digest('hex').slice(0, 16)
// Execute the existing routing logic using an adapter for Lambda@Edge's event format.
export function edgeRouteCode(): string {
  return `${routeCode('flatgirl.net')}\nexports.handler = async event => {
    const original = event.Records[0].cf.request;
    const querystring = Object.create(null);
    // Keep encoded campaign query bytes exactly as the CloudFront Function does.
    for (const pair of (original.querystring || '').split('&').filter(Boolean)) {
      const split = pair.indexOf('='), key = split < 0 ? pair : pair.slice(0, split);
      const item = {value: split < 0 ? '' : pair.slice(split + 1)};
      if (querystring[key]) {
        const entry = querystring[key]; entry.multiValue = [...(entry.multiValue || [{value:entry.value}]), item];
      } else Object.defineProperty(querystring, key, {value:item, enumerable:true, writable:true});
    }
    const request = {uri:original.uri, querystring,
      headers:Object.fromEntries(Object.entries(original.headers).map(([key, value]) => [key, {value:value[0].value}]))};
    const result = await handler({request});
    if (!result.statusCode) return original;
    return {status:String(result.statusCode), headers:Object.fromEntries(Object.entries(result.headers)
      .map(([key, entry]) => [key, [{key, value:entry.value}]]))};
  };`
}
