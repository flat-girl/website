import type { Metrics, Snapshot, Hour } from './metrics'
import { addDays, midnight, today, monday } from './metrics'
export function demoMetrics(environment = 'production', now = Date.now()): Metrics {
  const start = environment === 'production' ? Date.parse('2026-11-07T21:00:00Z') : midnight(addDays(today(now), -15))
  const hours: Hour[] = [], all = new Set<number>(), days = new Map<string, Set<number>>(), weeks = new Map<string, Set<number>>()
  for (let time = start; time < now; time += 3600000) {
    const n = Math.round((Math.sin(time / 3600000 * .7) + 1.2) * (environment === 'beta' ? 5 : 30)), count = Math.round(n * .7)
    hours.push([time / 1000, n, Math.round(n * (.08 + .06 * Math.cos(time / 3600000))), count, 0])
    const day = today(time), week = monday(day)
    if (!days.has(day)) days.set(day, new Set())
    if (!weeks.has(week)) weeks.set(week, new Set())
    for (let j = 0; j < count; j++) { const id = Math.floor(time / 3600000) * (environment === 'beta' ? 2 : 20) + j; all.add(id); days.get(day)!.add(id); weeks.get(week)!.add(id) }
  }
  const cumulative = new Set<number>()
  const uniqueDays: [string, number, number][] = [...days].map(([day, people]) => { for (const p of people) cumulative.add(p); return [day, people.size, cumulative.size] })
  const data: Snapshot = { schema: 2, generation: 'demo', startedAt: now - 2500, calculatedAt: now, freshUntil: now + 60000, firstEvent: start / 1000, coverageStart: start / 1000,
    totalViews: hours.reduce((n, h) => n + h[1], 0), totalLeads: hours.reduce((n, h) => n + h[2], 0), hours,
    totalUniqueViews: all.size, unidentifiedViews: 0, uniqueDays, uniqueWeeks: [...weeks].map(([week, people]) => [week, people.size]) }
  return { state: 'ready', environment, data, dlq: { visible: 0, inFlight: 0, delayed: 0, checkedAt: now, freshUntil: now + 60000, error: false, stale: false } }
}
