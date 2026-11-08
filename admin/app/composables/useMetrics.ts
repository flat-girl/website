import type { Metrics } from '#shared/metrics'
export function useMetrics() {
  const environment = ref<'production' | 'beta'>('production')
  const result = shallowRef<Metrics | null>(null)
  const phase = ref<'loading' | 'waiting' | 'updating' | 'viewing' | 'error'>('loading')
  const error = ref(''), pages = ref(0), busy = ref(false)
  const memory = new Map<string, Metrics>()
  let controller: AbortController | undefined, sequence = 0, timer: ReturnType<typeof setInterval> | undefined
  async function refresh() {
    if (busy.value || document.hidden) return
    busy.value = true; error.value = ''; pages.value = 0
    const run = ++sequence, env = environment.value
    controller = new AbortController(); const signal = controller.signal
    const call = async (ensure = false) => {
      const r = await fetch(ensure ? '/api/rollups/ensure' : `/api/metrics?environment=${env}`, {
        method: ensure ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
        ...(ensure ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ environment: env }) } : {}),
      })
      if (!r.ok) throw Error(r.status === 401 ? 'Your login expired. Reload to sign in again.' : 'Could not update dashboard data. Try Refresh.')
      return await r.json() as Metrics
    }
    try {
      let data = await call()
      if (run !== sequence) return
      if (data.data) { result.value = data; memory.set(env, data) }
      while (data.state !== 'ready') {
        if (document.hidden) break
        phase.value = data.state === 'waiting' ? 'waiting' : 'updating'
        if (data.pages) pages.value = data.pages
        if (data.retryAfterMs) await new Promise<void>((resolve, reject) => {
          const cancel = () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }
          const t = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, data.retryAfterMs)
          signal.addEventListener('abort', cancel, { once: true })
        })
        data = await call(true)
        if (run !== sequence) return
        if (data.data) { result.value = data; memory.set(env, data) }
      }
      phase.value = result.value?.data ? 'viewing' : 'loading'
    } catch (e) {
      if (run !== sequence || signal.aborted) return
      error.value = e instanceof Error ? e.message : 'Update failed'; phase.value = 'error'
    } finally { if (run === sequence) busy.value = false }
  }
  function change() {
    ++sequence; controller?.abort(); busy.value = false
    result.value = memory.get(environment.value) || null; phase.value = result.value ? 'viewing' : 'loading'
    void refresh()
  }
  const visibility = () => { if (!document.hidden) void refresh() }
  watch(environment, change)
  onMounted(() => { void refresh(); timer = setInterval(() => void refresh(), 60000); document.addEventListener('visibilitychange', visibility) })
  onBeforeUnmount(() => { ++sequence; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visibility) })
  return { environment, result, phase, error, pages, busy, refresh }
}
