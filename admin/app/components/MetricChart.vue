<script setup lang="ts">
import type { Point } from '#shared/metrics'
import { number, percent } from '#shared/metrics'
const props = defineProps<{ title: string; subtitle?: string; viewsLabel?: string; points: Point[] }>()
const metric = ref<'counts' | 'rate'>('counts')
const active = ref<number | null>(null)
const width = 840, height = 230, left = 48, top = 14, bottom = 30
const maximum = computed(() => Math.max(1, ...props.points.map(p => metric.value === 'rate' ? p.rate ?? 0 : Math.max(p.views, p.leads))))
const plotHeight = height - top - bottom
const slot = computed(() => (width - left - 12) / Math.max(1, props.points.length))
const y = (n: number) => top + plotHeight * (1 - n / maximum.value)
const tick = (n: number) => metric.value === 'rate' ? percent(n) : number(n)
const selected = computed(() => active.value === null ? null : props.points[active.value])
const path = (field: 'views' | 'leads' | 'rate') => props.points.map((p, i) => `${i ? 'L' : 'M'} ${left + slot.value * (i + .5)} ${y(p[field] ?? 0)}`).join(' ')
watch(() => props.points, () => { active.value = null })
</script>
<template>
  <section class="panel overflow-hidden">
    <div class="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
      <div><h2 class="font-semibold text-slate-900">{{ title }}</h2><p v-if="subtitle" class="mt-1 text-xs text-slate-500">{{ subtitle }}</p></div>
      <div class="flex rounded-lg bg-slate-100 p-1 text-xs" role="group" :aria-label="`${title} chart metric`">
        <button class="rounded-md px-3 py-1.5" :class="metric === 'counts' ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'" :aria-pressed="metric === 'counts'" @click="metric = 'counts'">{{ viewsLabel || 'Views' }} & Leads</button>
        <button class="rounded-md px-3 py-1.5" :class="metric === 'rate' ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'" :aria-pressed="metric === 'rate'" @click="metric = 'rate'">Event rate</button>
      </div>
    </div>
    <div class="mx-5 mt-4 flex h-6 items-center gap-4 text-xs text-slate-500" aria-live="polite">
      <template v-if="selected"><span class="font-semibold text-slate-700">{{ selected.label }}</span><span>{{ number(selected.views) }} {{ (viewsLabel || 'Views').toLowerCase() }}</span><span>{{ number(selected.leads) }} leads</span><span>{{ percent(selected.rate) }}</span><span v-if="selected.partial">Partial</span></template>
      <template v-else><span class="flex items-center gap-1.5"><span class="size-2 rounded-full bg-indigo-500" />{{ viewsLabel || 'Views' }}</span><span class="flex items-center gap-1.5"><span class="size-2 rounded-full bg-emerald-500" />Leads</span><span v-if="metric === 'rate'" class="text-violet-600">Leads ÷ {{ viewsLabel || 'Views' }}</span></template>
    </div>
    <div v-if="!points.length" class="flex h-52 items-center justify-center text-sm text-slate-500">No recorded data in this period.</div>
    <svg v-else :viewBox="`0 0 ${width} ${height}`" class="my-3 w-full px-3" role="img" :aria-label="`${title}. ${points.length} periods. Exact values in the data table below.`" @mouseleave="active = null">
      <g v-for="n in [0, 1, 2, 3, 4]" :key="n">
        <line :x1="left" :x2="width - 12" :y1="y(maximum * n / 4)" :y2="y(maximum * n / 4)" class="stroke-slate-100" />
        <text :x="left - 8" :y="y(maximum * n / 4) + 4" text-anchor="end" class="fill-slate-400 text-[10px]">{{ tick(maximum * n / 4) }}</text>
      </g>
      <template v-if="points.length > 45 && metric === 'counts'">
        <path :d="path('views')" fill="none" class="stroke-indigo-500" stroke-width="2" />
        <path :d="path('leads')" fill="none" class="stroke-emerald-500" stroke-width="2" />
      </template>
      <g v-for="(point, i) in points" :key="i" @mouseenter="active = i">
        <rect :x="left + i * slot" :y="top" :width="slot" :height="plotHeight" class="fill-transparent" />
        <template v-if="metric === 'counts' && points.length <= 45">
          <rect :x="left + i * slot + slot * .15" :y="y(point.views)" :width="Math.max(1, slot * .32)" :height="plotHeight - y(point.views) + top" rx="2" class="fill-indigo-500" :opacity="point.partial ? .5 : 1" />
          <rect :x="left + i * slot + slot * .5" :y="y(point.leads)" :width="Math.max(1, slot * .32)" :height="plotHeight - y(point.leads) + top" rx="2" class="fill-emerald-500" :opacity="point.partial ? .5 : 1" />
        </template>
        <rect v-if="metric === 'rate' && point.rate !== null" :x="left + i * slot + slot * .2" :y="y(point.rate)" :width="Math.max(1, slot * .6)" :height="plotHeight - y(point.rate) + top" rx="2" class="fill-violet-500" :opacity="point.partial ? .5 : 1" />
        <text v-if="i % Math.max(1, Math.ceil(points.length / 8)) === 0" :x="left + slot * (i + .5)" :y="height - 8" text-anchor="middle" class="fill-slate-400 text-[10px]">{{ point.label.length === 10 ? point.label.slice(5) : point.label }}</text>
      </g>
    </svg>
    <details class="border-t border-slate-100 px-5 py-3 text-xs">
      <summary class="cursor-pointer font-medium text-slate-500">View data table</summary>
      <div class="mt-3 max-h-64 overflow-auto"><table class="w-full text-right tabular-nums"><caption class="sr-only">{{ title }} exact values</caption><thead class="sticky top-0 bg-white text-slate-500"><tr><th class="py-2 text-left">Period</th><th>{{ viewsLabel || 'Views' }}</th><th>Leads</th><th>Event rate</th><th>Status / samples</th></tr></thead><tbody><tr v-for="(p, i) in points" :key="i" class="border-t border-slate-100"><th class="py-2 text-left font-normal">{{ p.label }}</th><td>{{ p.occurrences === 0 ? '—' : number(p.views) }}</td><td>{{ p.occurrences === 0 ? '—' : number(p.leads) }}</td><td>{{ percent(p.rate) }}</td><td>{{ p.partial ? 'Partial' : p.occurrences === undefined ? 'Complete' : `${p.occurrences} samples` }}</td></tr></tbody></table></div>
    </details>
  </section>
</template>
