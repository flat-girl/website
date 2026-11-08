import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildView, midnight, monday, rate, type Snapshot } from '../shared/metrics.ts'
function snapshot(hours: Snapshot['hours'], first: string, end: string): Snapshot {
  return { schema: 1, generation: 'fixture', startedAt: Date.parse(end), calculatedAt: Date.parse(end), freshUntil: Date.parse(end) + 60000,
    firstEvent: Date.parse(first) / 1000, totalViews: hours.reduce((n, h) => n + h[1], 0), totalLeads: hours.reduce((n, h) => n + h[2], 0), hours }
}
test('Chicago midnight, Monday boundaries, and DST have actual elapsed-hour semantics', () => {
  assert.equal(new Date(midnight('2026-11-01')).toISOString(), '2026-11-01T05:00:00.000Z')
  assert.equal(new Date(midnight('2026-11-02')).toISOString(), '2026-11-02T06:00:00.000Z')
  assert.equal(monday('2026-11-08'), '2026-11-02')
  const d = snapshot([], '2026-11-01T05:00:00Z', '2026-11-02T06:00:00Z')
  const v = buildView(d, 'day', '2026-11-01', '2026-11-01', '2026-11-01')
  assert.equal(v.series.length, 25)
  assert.equal(v.typicalDay[1]!.occurrences, 2)
})
test('weighted rates include zero periods and exclude partial ones from averages', () => {
  const h = (date: string) => Date.parse(date) / 1000
  const d = snapshot([[h('2026-11-02T06:00:00Z'), 100, 10], [h('2026-11-03T06:00:00Z'), 1, 1], [h('2026-11-04T06:00:00Z'), 10, 8]], '2026-11-02T06:00:00Z', '2026-11-04T06:30:00Z')
  const v = buildView(d, 'all', '2026-11-04', '2026-11-02', '2026-11-04')
  assert.equal(v.typicalDay[0]!.views, 50.5); assert.equal(v.typicalDay[0]!.leads, 5.5)
  assert.equal(v.typicalDay[0]!.rate, 11 / 101 * 100)
  assert.equal(v.typicalDay[1]!.occurrences, 2); assert.equal(v.typicalDay[1]!.rate, null)
  assert.equal(v.averageDay.occurrences, 2); assert.equal(v.averageWeek.occurrences, 0)
  assert.equal(v.totals.leads, 19); assert.equal(v.series.at(-1)?.partial, true)
})
test('rates are not clamped; all time has no fixed start or end date', () => {
  assert.equal(rate(1, 3), 300); assert.equal(rate(0, 3), null)
  const d = snapshot([[Date.parse('2027-01-03T12:00:00Z') / 1000, 1, 3]], '2027-01-03T06:00:00Z', '2027-01-04T06:00:00Z')
  assert.equal(buildView(d, 'all', '2027-01-03', '2027-01-03', '2027-01-03').totals.leads, 3)
})

test('unique day/week/all-time totals and cumulative counts are not sums of hourly uniques', () => {
  const h = (date: string) => Date.parse(date) / 1000
  const d = snapshot([[h('2026-11-07T21:00:00Z'), 3, 1, 1, 0], [h('2026-11-07T22:00:00Z'), 2, 0, 1, 0], [h('2026-11-08T06:00:00Z'), 3, 1, 2, 0]], '2026-11-07T21:15:00Z', '2026-11-09T06:00:00Z')
  Object.assign(d, { schema: 2, coverageStart: h('2026-11-07T21:00:00Z'), totalUniqueViews: 2, unidentifiedViews: 0,
    uniqueDays: [['2026-11-07', 1, 1], ['2026-11-08', 2, 2]], uniqueWeeks: [['2026-11-02', 2]] })
  const day = buildView(d, 'day', '2026-11-07', '2026-11-07', '2026-11-08', 'unique')
  assert.equal(day.totals.views, 1); assert.equal(day.series.reduce((n, x) => n + x.views, 0), 2)
  assert.equal(day.series[0]!.partial, false)
  assert.equal(day.typicalDay[15]!.occurrences, 2)
  const all = buildView(d, 'all', '2026-11-08', '2026-11-07', '2026-11-08', 'unique')
  assert.equal(all.totals.views, 2); assert.equal(all.series.reduce((n, x) => n + x.views, 0), 3)
  assert.equal(all.cumulative.at(-1)!.views, 2)
  assert.equal(buildView(d, 'week', '2026-11-08', '2026-11-07', '2026-11-08', 'unique').totals.views, 2)
  assert.equal(buildView(d, 'all', '2026-11-08', '2026-11-07', '2026-11-08', 'total').totals.views, 8)
})
