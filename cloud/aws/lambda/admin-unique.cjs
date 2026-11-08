const { createHmac } = require('node:crypto')
const { isIP } = require('node:net')
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' })
function dateOf(hour) {
  const p = Object.fromEntries(dateFormat.formatToParts(hour * 1000).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
function weekOf(date) {
  const time = Date.parse(date + 'T12:00:00Z'), day = new Date(time).getUTCDay()
  return new Date(time - ((day + 6) % 7) * 86400000).toISOString().slice(0, 10)
}
function fingerprint(item, salt) {
  const ip = item.client_ip_address?.S, agent = item.client_user_agent?.S
  if (typeof ip !== 'string' || !isIP(ip) || typeof agent !== 'string' || !agent.trim() || agent.length > 2048) return null
  const canonical = isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname : ip
  return createHmac('sha256', Buffer.from(salt, 'hex')).update(JSON.stringify([canonical, agent.trim()])).digest('hex')
}
function summarize(chunks) {
  const hours = new Map(), hourPeople = new Map(), dayPeople = new Map(), weekPeople = new Map(), all = new Set()
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, new Set()); if (value !== undefined) map.get(key).add(value) }
  for (const chunk of chunks) {
    for (const [hour, views, leads, unknown = 0] of chunk.hours) {
      if (!hours.has(hour)) hours.set(hour, [hour, 0, 0, 0, 0])
      const bucket = hours.get(hour); bucket[1] += views; bucket[2] += leads; bucket[4] += unknown
      const date = dateOf(hour); add(dayPeople, date); add(weekPeople, weekOf(date))
    }
    for (const [person, visited] of Object.entries(chunk.identities || {})) {
      all.add(person)
      for (const hour of visited) {
        const date = dateOf(hour)
        add(hourPeople, hour, person); add(dayPeople, date, person); add(weekPeople, weekOf(date), person)
      }
    }
  }
  for (const [hour, people] of hourPeople) hours.get(hour)[3] = people.size
  const cumulative = new Set()
  const uniqueDays = [...dayPeople].sort(([a], [b]) => a.localeCompare(b)).map(([date, people]) => {
    for (const person of people) cumulative.add(person)
    return [date, people.size, cumulative.size]
  })
  return { hours: [...hours.values()].sort((a, b) => a[0] - b[0]), totalUniqueViews: all.size,
    unidentifiedViews: [...hours.values()].reduce((n, h) => n + h[4], 0), uniqueDays,
    uniqueWeeks: [...weekPeople].sort(([a], [b]) => a.localeCompare(b)).map(([week, people]) => [week, people.size]) }
}
exports.fingerprint = fingerprint
exports.summarize = summarize
