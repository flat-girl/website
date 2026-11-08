<script setup lang="ts">
import sarahIcon from '~/assets/images/sarah-icon.png'
import sarahFavicon from '~/assets/images/favicon.ico?url'
useHead({ link: [{ key: 'sarah-favicon', rel: 'icon', type: 'image/x-icon', href: sarahFavicon }] })
import { addDays, buildView, monday, number, percent, today } from '#shared/metrics'
const { environment, result, phase, error, pages, busy, refresh } = useMetrics()
const mode = ref<'day' | 'week' | 'all'>('day')
const date = ref(''), averageStart = ref(''), averageEnd = ref('')
const cumulative = ref(false)
const viewBasis = ref<'unique' | 'total'>('unique')
const development = import.meta.dev
const data = computed(() => result.value?.data)
const usingUnique = computed(() => viewBasis.value === 'unique' && data.value?.totalUniqueViews !== undefined)
const viewsLabel = computed(() => usingUnique.value ? 'Est. unique views' : 'Total views')
const allViews = computed(() => usingUnique.value ? data.value?.totalUniqueViews ?? 0 : data.value?.totalViews ?? 0)
const lastDate = computed(() => data.value ? today(data.value.calculatedAt) : date.value)
const firstDate = computed(() => (data.value?.coverageStart ?? data.value?.firstEvent) != null ? today((data.value!.coverageStart ?? data.value!.firstEvent)! * 1000) : lastDate.value)
watch(data, (value, previous) => {
  if (!value) return
  const previousDate = previous ? today(previous.calculatedAt) : null
  if (!date.value || date.value === previousDate) date.value = today(value.calculatedAt)
  if (!averageStart.value) averageStart.value = firstDate.value
  if (!averageEnd.value || averageEnd.value === previousDate) averageEnd.value = lastDate.value
})
watch(environment, () => { date.value = ''; averageStart.value = ''; averageEnd.value = '' })
const view = computed(() => data.value && date.value ? buildView(data.value, mode.value, date.value, averageStart.value || firstDate.value, averageEnd.value || lastDate.value, viewBasis.value) : null)
const selectedRange = computed(() => mode.value === 'all' ? 'All recorded history' : mode.value === 'week' ? `${monday(date.value)} — ${addDays(monday(date.value), 6)}` : date.value)
const heading = computed(() => mode.value === 'day' ? 'Hourly activity' : mode.value === 'week' ? 'Daily activity' : cumulative.value ? 'Cumulative growth' : 'Daily growth')
const stamp = (ms?: number) => ms ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(ms) : 'Not checked'
const queue = computed(() => result.value?.dlq)
const queueTotal = computed(() => queue.value && !queue.value.error ? (queue.value.visible ?? 0) + (queue.value.inFlight ?? 0) + (queue.value.delayed ?? 0) : null)
const queueLabel = computed(() => !queue.value || queue.value.error ? 'Unavailable' : queue.value.stale || phase.value === 'error' || Date.now() > queue.value.freshUntil ? 'Stale' : queueTotal.value ? 'Needs attention' : 'Empty')
const phaseLabel = computed(() => ({ loading: 'Loading dashboard', waiting: 'Waiting for rollup mutex', updating: 'Updating dashboard data', viewing: 'Viewing', error: 'Update unavailable' })[phase.value])
function step(direction: number) {
  const candidate = addDays(date.value, direction * (mode.value === 'week' ? 7 : 1))
  date.value = candidate < firstDate.value ? firstDate.value : candidate > lastDate.value ? lastDate.value : candidate
}
onMounted(() => { date.value ||= today() })
</script>
<template>
  <div class="min-h-screen">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div class="flex items-center gap-3"><img :src="sarahIcon" alt="Sarah" width="36" height="36" class="size-9 rounded-lg object-cover"><div class="flex items-baseline gap-3"><span class="font-semibold tracking-tight">Flat Girl</span><span class="text-sm text-slate-400">/</span><span class="text-sm text-slate-500">Analytics</span></div></div>
        <label class="flex items-center gap-2 text-xs text-slate-500"><span class="size-2 rounded-full" :class="environment === 'production' ? 'bg-emerald-500' : 'bg-amber-500'" /><span class="sr-only">Environment</span><select v-model="environment" class="rounded-md bg-slate-50 px-2 py-1.5 font-medium text-slate-700"><option value="production">Production</option><option value="beta">Beta</option></select></label>
      </div>
    </header>
    <main class="mx-auto max-w-7xl space-y-6 px-5 py-8 sm:px-8">
      <p v-if="development" class="rounded-lg bg-amber-50 px-4 py-2 text-xs text-amber-800">Local demo data · No AWS requests or authentication in development</p>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div><p class="eyebrow">Audience overview</p><h1 class="mt-1 text-3xl font-semibold tracking-tight">Signup dashboard</h1><p class="mt-2 text-sm text-slate-500">Traffic, signups, and the patterns between them.</p></div>
        <div class="text-right"><label class="mr-2"><span class="sr-only">View counting</span><select v-model="viewBasis" class="control"><option value="unique">Unique views (estimated)</option><option value="total">Total views</option></select></label><button class="control font-medium" :disabled="busy" @click="refresh">{{ busy ? 'Updating…' : '↻ Refresh' }}</button><p class="mt-2 text-xs text-slate-400">{{ data ? `Updated ${stamp(data.calculatedAt)}` : 'Waiting for data' }}</p></div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-xs" :class="error ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-500'" role="status" aria-live="polite">
        <span class="flex items-center gap-2"><span class="size-1.5 rounded-full" :class="phase === 'viewing' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'" />{{ phaseLabel }}<span v-if="phase === 'updating' && pages">· {{ pages }} pages processed</span><span v-if="error">· {{ error }}</span></span><span>America/Chicago · Auto-refresh while open</span>
      </div>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <section class="panel p-5"><p class="eyebrow">Recorded signups · all time</p><p class="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{{ data ? number(data.totalLeads) : '—' }}</p><p class="mt-2 text-xs text-slate-500">Stored Lead events</p></section>
        <section class="panel p-5"><p class="eyebrow">{{ viewsLabel }} · all time</p><p class="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{{ data ? number(allViews) : '—' }}</p><p class="mt-2 text-xs text-slate-500">{{ usingUnique ? 'One IP + browser pair per period' : 'Every stored ViewContent event' }}</p></section>
        <section class="panel p-5"><p class="eyebrow">{{ usingUnique ? 'Lead / unique-view rate' : 'View → Lead event rate' }}</p><p class="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{{ data ? percent(allViews ? data.totalLeads / allViews * 100 : null) : '—' }}</p><p class="mt-2 text-xs text-slate-500">All-time Leads ÷ {{ viewsLabel.toLowerCase() }}</p></section>
        <section class="panel p-5"><p class="eyebrow">Dead-letter queue</p><p class="mt-3 text-2xl font-semibold tracking-tight" :class="queueLabel === 'Empty' ? 'text-emerald-600' : 'text-amber-600'">{{ queueLabel }}<span v-if="queueTotal" class="ml-2 text-base">{{ number(queueTotal) }}</span></p><p class="mt-2 text-xs text-slate-500">Approximate · {{ stamp(queue?.checkedAt) }}</p></section>
      </div>
      <template v-if="view && data">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div class="flex rounded-lg bg-slate-200/70 p-1 text-sm" role="group" aria-label="Time view"><button v-for="tab in (['day', 'week', 'all'] as const)" :key="tab" class="rounded-md px-5 py-2 font-medium" :class="mode === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'" :aria-pressed="mode === tab" @click="mode = tab">{{ tab === 'all' ? 'All time' : tab === 'day' ? 'Day' : 'Week' }}</button></div>
          <div v-if="mode !== 'all'" class="flex items-center gap-2"><button class="control" aria-label="Previous period" :disabled="(mode === 'week' ? monday(date) : date) <= firstDate" @click="step(-1)">←</button><label><span class="sr-only">Selected date</span><input v-model="date" class="control" type="date" :min="firstDate" :max="lastDate"></label><button class="control" aria-label="Next period" :disabled="(mode === 'week' ? addDays(monday(date), 7) : addDays(date, 1)) > lastDate" @click="step(1)">→</button></div>
          <label v-else class="flex items-center gap-2 text-sm text-slate-600"><input v-model="cumulative" type="checkbox" class="accent-indigo-600">Cumulative totals</label>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-sm font-medium text-slate-600">{{ selectedRange }}</p><p class="flex gap-5 text-sm tabular-nums"><span><strong>{{ number(view.totals.views) }}</strong> <span class="text-slate-500">{{ viewsLabel.toLowerCase() }}</span></span><span><strong>{{ number(view.totals.leads) }}</strong> <span class="text-slate-500">leads</span></span><span><strong>{{ percent(view.totals.rate) }}</strong> <span class="text-slate-500">lead rate</span></span></p></div>
        <MetricChart :views-label="viewsLabel" :title="heading" subtitle="Original event times · Lighter bars indicate partial periods" :points="mode === 'all' && cumulative ? view.cumulative : view.series" />
        <div class="flex flex-wrap items-end justify-between gap-4 pt-3"><div><h2 class="text-lg font-semibold tracking-tight">Typical patterns</h2><p class="mt-1 text-sm text-slate-500">Average activity across complete periods, including zero-signup periods.</p></div><div class="flex flex-wrap items-center gap-2"><label class="text-xs text-slate-500">From <input v-model="averageStart" class="control ml-1" aria-label="Average start date" type="date" :min="firstDate" :max="averageEnd"></label><label class="text-xs text-slate-500">To <input v-model="averageEnd" class="control ml-1" aria-label="Average end date" type="date" :min="averageStart" :max="lastDate"></label></div></div>
        <div class="grid gap-5 lg:grid-cols-2"><MetricChart :views-label="viewsLabel" title="Typical day" :subtitle="`Average ${viewsLabel.toLowerCase()} and leads by hour`" :points="view.typicalDay" /><MetricChart :views-label="viewsLabel" title="Typical week" :subtitle="`Average ${viewsLabel.toLowerCase()} and leads by weekday`" :points="view.typicalWeek" /></div>
        <div class="panel flex flex-wrap gap-x-10 gap-y-3 px-5 py-4 text-sm"><span><span class="text-slate-500">Leads / complete day</span> <strong class="ml-2">{{ view.averageDay.occurrences ? number(view.averageDay.leads) : '—' }}</strong></span><span><span class="text-slate-500">Leads / complete week</span> <strong class="ml-2">{{ view.averageWeek.occurrences ? number(view.averageWeek.leads) : '—' }}</strong></span><span class="text-xs text-slate-400">Partial periods are excluded from averages.</span></div>
        <p class="max-w-4xl text-xs leading-relaxed text-slate-400">Unique views estimate distinct IP + browser pairs within each period. Shared connections can merge people; changing networks or browsers can split one person. Daily, weekly, and all-time uniques are deduplicated separately and cannot be added together. Total views include repeat visits. Privacy preferences can suppress Views without suppressing Leads, and a signup can follow a view in another period. Lead rates are not matched-person funnels and can exceed 100%. {{ data.unidentifiedViews ? `${number(data.unidentifiedViews)} views lack identifying metadata and are excluded from unique counts.` : '' }} History begins {{ stamp((data.coverageStart ?? data.firstEvent) == null ? undefined : (data.coverageStart ?? data.firstEvent)! * 1000) }}; events still awaiting archival are not included.</p>
      </template>
      <div v-else class="panel flex min-h-72 flex-col items-center justify-center gap-3 p-8 text-center"><div class="size-8 rounded-full border-2 border-indigo-100 border-t-indigo-500" :class="!error && 'animate-spin'" /><p class="font-medium">{{ error ? 'Dashboard data is unavailable' : 'Preparing your dashboard' }}</p><p class="max-w-md text-sm text-slate-500">{{ error || 'The first visit calculates and saves your metrics. Future visits reuse those results.' }}</p></div>
    </main>
    <footer class="mx-auto max-w-7xl px-8 pb-6 text-xs text-slate-400">Flat Girl · Internal analytics</footer>
  </div>
</template>
