import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
// Both environments run the same router; only the environment configuration differs.
export const edgeRouteName = (env: MetaEnvironment) => `flat-girl-${env}-edge-routes`
export const betaAuthParameter = '/flat-girl/beta/authorization-sha256'
export function edgeRouteCode(env: MetaEnvironment = 'production'): string {
  const source = readFileSync(new URL('../lambda/edge-router.cjs', import.meta.url), 'utf8')
  return `const __environment = ${JSON.stringify(env)};\n${source}`
}
