import { demoMetrics } from '#shared/demo'
export default defineEventHandler(event => {
  if (!import.meta.dev) throw createError({ statusCode: 404 })
  const environment = getQuery(event).environment === 'beta' ? 'beta' : 'production'
  return demoMetrics(environment)
})
