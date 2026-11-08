import { demoMetrics } from '#shared/demo'
export default defineEventHandler(async event => {
  if (!import.meta.dev) throw createError({ statusCode: 404 })
  const body = await readBody(event)
  return demoMetrics(body?.environment === 'beta' ? 'beta' : 'production')
})
