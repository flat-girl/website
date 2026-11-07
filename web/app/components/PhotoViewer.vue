<script setup lang="ts">
const props = defineProps<{ images: ReturnType<typeof useImages>; index: number }>()
const emit = defineEmits<{ 'update:index': [index: number]; close: [] }>()
const dialog = ref<HTMLDialogElement>()
const stage = ref<HTMLElement>()
const current = computed(() => props.images[props.index]!)
const stageWidth = ref(0)
const stageHeight = ref(0)
const scale = ref(1)
const x = ref(0)
const y = ref(0)
const fullLoaded = ref(false)
const fullFailed = ref(false)
const dragging = ref(false)
const fit = computed(() => Math.min(stageWidth.value / current.value.width, stageHeight.value / current.value.height, 1))
const imageWidth = computed(() => current.value.width * fit.value)
const imageHeight = computed(() => current.value.height * fit.value)
const imageStyle = computed(() => ({
  width: `${imageWidth.value}px`,
  height: `${imageHeight.value}px`,
  transform: `translate(-50%, -50%) translate(${x.value}px, ${y.value}px) scale(${scale.value})`,
}))
type Point = { x: number; y: number }
const pointers = new Map<number, Point>()
let startPoint: Point = { x: 0, y: 0 }
let allowClick = true
let observer: ResizeObserver | undefined
let previousOverflow = ''

function resetZoom() {
  scale.value = 1
  x.value = 0
  y.value = 0
  pointers.clear()
  dragging.value = false
}

function clampPan() {
  const limitX = Math.max(0, (imageWidth.value * scale.value - stageWidth.value) / 2)
  const limitY = Math.max(0, (imageHeight.value * scale.value - stageHeight.value) / 2)
  x.value = Math.max(-limitX, Math.min(limitX, x.value))
  y.value = Math.max(-limitY, Math.min(limitY, y.value))
}

function zoomTo(value: number, anchor: Point = { x: 0, y: 0 }, target = anchor) {
  const next = Math.max(1, Math.min(5, value))
  const ratio = next / scale.value
  x.value = target.x - (anchor.x - x.value) * ratio
  y.value = target.y - (anchor.y - y.value) * ratio
  scale.value = next
  clampPan()
}

function point(event: { clientX: number; clientY: number }): Point {
  const bounds = stage.value!.getBoundingClientRect()
  return { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 }
}

function pointerDown(event: PointerEvent) {
  if (event.button !== 0 || pointers.size >= 2) return
  if (!pointers.size) {
    startPoint = point(event)
    allowClick = true
  } else allowClick = false
  pointers.set(event.pointerId, point(event))
  stage.value?.setPointerCapture(event.pointerId)
  dragging.value = true
}

function pinch() {
  const [a, b] = [...pointers.values()] as [Point, Point]
  return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(b.x - a.x, b.y - a.y) }
}

function pointerMove(event: PointerEvent) {
  const previous = pointers.get(event.pointerId)
  if (!previous) return
  const next = point(event)
  if (Math.hypot(next.x - startPoint.x, next.y - startPoint.y) > 5) allowClick = false
  if (pointers.size === 2) {
    const before = pinch()
    pointers.set(event.pointerId, next)
    const after = pinch()
    if (before.distance > 0) zoomTo(scale.value * after.distance / before.distance, before.center, after.center)
  } else {
    pointers.set(event.pointerId, next)
    x.value += next.x - previous.x
    y.value += next.y - previous.y
    clampPan()
  }
}

function pointerUp(event: PointerEvent) {
  pointers.delete(event.pointerId)
  dragging.value = pointers.size > 0
  if (event.type === 'pointercancel') allowClick = false
}

function toggleZoom(event: MouseEvent) {
  if (allowClick) zoomTo(scale.value > 1 ? 1 : 2, point(event))
}

function wheelZoom(event: WheelEvent) {
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stageHeight.value : 1)
  zoomTo(scale.value * Math.exp(-delta * 0.002), point(event))
}

function move(offset: number) {
  emit('update:index', (props.index + offset + props.images.length) % props.images.length)
}

function keydown(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === 'Tab') {
    const buttons = dialog.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    const first = buttons[0]!
    const last = buttons[buttons.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
    return
  }
  switch (event.key) {
    case 'ArrowLeft': move(-1); break
    case 'ArrowRight': move(1); break
    case '+': case '=': zoomTo(scale.value * 1.5); break
    case '-': zoomTo(scale.value / 1.5); break
    case '0': resetZoom(); break
    default: return
  }
  event.preventDefault()
}

watch(() => props.index, () => {
  resetZoom()
  fullLoaded.value = false
  fullFailed.value = false
})

onMounted(() => {
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  dialog.value?.showModal()
  observer = new ResizeObserver(() => {
    stageWidth.value = stage.value!.clientWidth
    stageHeight.value = stage.value!.clientHeight
    clampPan()
  })
  observer.observe(stage.value!)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  dialog.value?.close()
  document.body.style.overflow = previousOverflow
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="photo-viewer" aria-label="Full-size photo viewer" aria-describedby="viewer-help"
      @close="emit('close')" @keydown="keydown">
      <div class="viewer-toolbar">
        <div class="zoom-controls" aria-label="Zoom controls" role="group">
          <button type="button" aria-label="Zoom out" :disabled="scale <= 1" @click="zoomTo(scale / 1.5)">−</button>
          <button type="button" aria-label="Zoom in" :disabled="scale >= 5" @click="zoomTo(scale * 1.5)">+</button>
        </div>
        <button type="button" autofocus @click="dialog?.close()">Close</button>
      </div>
      <div ref="stage" class="viewer-stage" :class="{ zoomed: scale > 1, dragging }"
        @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp"
        @pointercancel="pointerUp" @lostpointercapture="pointerUp" @click="toggleZoom" @wheel.prevent="wheelZoom">
        <img :src="current.src" :srcset="current.srcset" :sizes="current.sizes" alt="" aria-hidden="true"
          :style="imageStyle" draggable="false">
        <img :key="current.full" :src="current.full" :alt="current.alt" :style="imageStyle"
          :class="{ loading: !fullLoaded }" draggable="false" fetchpriority="high"
          @load="fullLoaded = true" @error="fullFailed = true">
      </div>
      <div class="viewer-footer">
        <p v-if="!fullLoaded" role="status" class="loading-message">
          {{ fullFailed ? 'Full-size photo could not load. Showing preview.' : 'Loading full-size photo…' }}
        </p>
        <div class="viewer-navigation">
          <button type="button" @click="move(-1)">Previous</button>
          <p role="status" aria-live="polite" aria-atomic="true">{{ index + 1 }} of {{ images.length }}</p>
          <button type="button" @click="move(1)">Next</button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.photo-viewer {
  position: fixed;
  inset: 0;
  width: 100%;
  max-width: none;
  height: 100dvh;
  max-height: none;
  margin: 0;
  border: 0;
  padding: max(0.75rem, env(safe-area-inset-top)) max(0.75rem, env(safe-area-inset-right)) max(0.75rem, env(safe-area-inset-bottom)) max(0.75rem, env(safe-area-inset-left));
  color: white;
  background: #111;
  overflow: hidden;
  overscroll-behavior: contain;
}

.photo-viewer[open] {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.photo-viewer::backdrop {
  background: #111;
}

.viewer-toolbar,
.zoom-controls,
.viewer-navigation {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.viewer-toolbar {
  justify-content: space-between;
  flex-wrap: wrap;
}

button {
  min-width: 44px;
  min-height: 44px;
  border-color: #777;
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

.viewer-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: zoom-in;
}

.viewer-stage.zoomed {
  cursor: grab;
}

.viewer-stage.zoomed.dragging {
  cursor: grabbing;
}

.viewer-stage img {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  pointer-events: none;
}

.viewer-stage img.loading {
  opacity: 0;
}

.viewer-footer {
  text-align: center;
  font-size: 0.875rem;
}

.viewer-navigation {
  justify-content: center;
  margin-top: 0.5rem;
  font-size: 1rem;
}

.loading-message {
  color: #ccc;
}
</style>
