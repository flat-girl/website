export type Hour = [number, number, number, number?, number?]
export interface Snapshot {
  schema: number; generation: string; startedAt: number; calculatedAt: number; freshUntil: number;
  coverageStart?: number | null; firstEvent: number | null; totalUniqueViews?: number; unidentifiedViews?: number;
  uniqueDays?: [string, number, number][]; uniqueWeeks?: [string, number][]; totalViews: number; totalLeads: number; hours: Hour[]
}
export interface QueueSnapshot { visible?: number; inFlight?: number; delayed?: number; checkedAt?: number; freshUntil: number; error: boolean; stale: boolean }
export interface Metrics { state: 'ready' | 'missing' | 'stale' | 'waiting' | 'updating'; environment?: string; data?: Snapshot | null; dlq?: QueueSnapshot | null; pages?: number; retryAfterMs?: number }
export interface Point { label: string; views: number; leads: number; rate: number | null; partial?: boolean; occurrences?: number }
export const zone = 'America/Chicago'
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
export function localParts(ms: number) {
  const p = Object.fromEntries(parts.formatToParts(ms).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
}
export const today = (ms = Date.now()) => localParts(ms).date
export function addDays(date: string, n: number) { return new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10) }
export function monday(date: string) { const d = new Date(date + 'T12:00:00Z').getUTCDay(); return addDays(date, -((d + 6) % 7)) }
export function midnight(date: string) {
  const target = Date.parse(date + 'T00:00:00Z'); let guess = target + 6 * 3600000
  for (let i = 0; i < 3; i++) { const p = localParts(guess); guess += target - (Date.parse(p.date + 'T00:00:00Z') + p.hour * 3600000) }
  return guess
}
export const rate = (views: number, leads: number) => views ? leads / views * 100 : null
export const percent = (r: number | null) => r === null ? '—' : `${r.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
export const number = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })
export function buildView(data: Snapshot, mode: 'day' | 'week' | 'all', selected: string, averageStart: string, averageEnd: string, basis: 'total' | 'unique' = 'total') {
  const end = data.calculatedAt, first = (data.coverageStart ?? data.firstEvent ?? Math.floor(end / 1000)) * 1000
  const unique = basis === 'unique' && data.totalUniqueViews !== undefined
  const uniqueDays = new Map((data.uniqueDays || []).map(d => [d[0], d]))
  const uniqueWeeks = new Map(data.uniqueWeeks || [])
  const source = new Map(data.hours.map(h => [h[0] * 1000, h]))
  const hourly: (Point & { time: number; date: string; hour: number })[] = []
  const daily: (Point & { date: string; time: number; complete: boolean })[] = []
  for (let date = today(first); date <= today(end); date = addDays(date, 1)) {
    const begin = midnight(date), finish = midnight(addDays(date, 1))
    const day = { label: date, date, time: begin, views: 0, leads: 0, rate: null as number | null, complete: begin >= first && finish <= end, partial: begin < first || finish > end }
    for (let time = Math.max(begin, Math.floor(first / 3600000) * 3600000); time < Math.min(finish, end); time += 3600000) {
      const h = source.get(time), v = (unique ? h?.[3] : h?.[1]) ?? 0, l = h?.[2] ?? 0
      const hour = localParts(time).hour
      hourly.push({ label: new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', timeZoneName: 'short' }).format(time), time, date, hour,
        views: v, leads: l, rate: rate(v, l), partial: time < first || time + 3600000 > end })
      day.views += v; day.leads += l
    }
    if (unique) day.views = uniqueDays.get(date)?.[1] ?? 0
    day.rate = rate(day.views, day.leads); daily.push(day)
  }
  const week = monday(selected)
  const series: Point[] = mode === 'day' ? hourly.filter(x => x.date === selected) : mode === 'week' ? daily.filter(x => x.date >= week && x.date < addDays(week, 7)) : daily
  const sum = (rows: Point[]) => { const views = rows.reduce((n, x) => n + x.views, 0), leads = rows.reduce((n, x) => n + x.leads, 0); return { views, leads, rate: rate(views, leads) } }
  const avg = (rows: Point[], label: string): Point => { const s = sum(rows); return { label, views: rows.length ? s.views / rows.length : 0, leads: rows.length ? s.leads / rows.length : 0, rate: s.rate, occurrences: rows.length } }
  const eligibleHours = hourly.filter(x => !x.partial && x.date >= averageStart && x.date <= averageEnd)
  const eligibleDays = daily.filter(x => x.complete && x.date >= averageStart && x.date <= averageEnd)
  const typicalDay = Array.from({ length: 24 }, (_, h) => avg(eligibleHours.filter(x => x.hour === h), `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`))
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const typicalWeek = weekdays.map((label, i) => avg(eligibleDays.filter(x => (new Date(x.date + 'T12:00:00Z').getUTCDay() + 6) % 7 === i), label))
  const weeks = new Map<string, typeof daily>()
  for (const day of eligibleDays) { const w = monday(day.date); const days = weeks.get(w) || []; days.push(day); weeks.set(w, days) }
  const fullWeeks = [...weeks.values()].filter(x => x.length === 7).map(x => {
    const totals = sum(x), label = x[0]!.date
    if (unique) { totals.views = uniqueWeeks.get(monday(label)) ?? 0; totals.rate = rate(totals.views, totals.leads) }
    return { ...totals, label }
  })
  let views = 0, leads = 0
  const cumulative = daily.map(x => { views = unique ? uniqueDays.get(x.date)?.[2] ?? views : views + x.views; leads += x.leads; return { label: x.date, views, leads, rate: rate(views, leads), partial: x.partial } })
  const totals = sum(series)
  if (unique) {
    totals.views = mode === 'day' ? uniqueDays.get(selected)?.[1] ?? 0 : mode === 'week' ? uniqueWeeks.get(week) ?? 0 : data.totalUniqueViews!
    totals.rate = rate(totals.views, totals.leads)
  }
  return { series, totals, typicalDay, typicalWeek, cumulative, averageDay: avg(eligibleDays, 'day'), averageWeek: avg(fullWeeks, 'week') }
}
