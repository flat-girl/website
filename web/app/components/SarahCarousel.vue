<script setup lang="ts">
const availableImages = useImages()
// Preparing an asset does not select it for this carousel.
const images = [
  'flatgirl-shoota-couch04',
  'flatgirl-shoota-chair04',
  'flatgirl-shoota-rug02front',
  'flatgirl-shoota-rug02back',
  'flatgirl-shoota-bed02',
  'flatgirl-shoota-chair03',
  'flatgirl-shoota-outside01',
].map(id => {
  const image = availableImages.find(image => image.id === id)
  if (!image) throw new Error(`Missing carousel image: ${id}`)
  return image
})
const active = ref(0)
const ready = ref(false)
const viewerOpen = ref(false)
const carousel = ref<HTMLElement>()
let disposed = false
let idleId: number | undefined
let backgroundTimer: number | undefined
const pendingPreloads = new Set<() => void>()

function preload(image: typeof images[number], fullSize: boolean) {
  return new Promise<void>(resolve => {
    const preloadImage = new Image()
    const finish = () => {
      window.clearTimeout(timeout)
      preloadImage.onload = null
      preloadImage.onerror = null
      pendingPreloads.delete(finish)
      resolve()
    }
    const timeout = window.setTimeout(finish, 15000)
    pendingPreloads.add(finish)
    preloadImage.onload = finish
    preloadImage.onerror = finish
    preloadImage.fetchPriority = 'low'
    preloadImage.decoding = 'async'
    if (!fullSize) {
      preloadImage.sizes = image.sizes
      preloadImage.srcset = image.srcset
    }
    preloadImage.src = fullSize ? image.full : image.src
  })
}

async function preloadLargeImages() {
  // One low-priority request at a time keeps the page responsive.
  for (const image of images) {
    if (disposed) return
    await preload(image, true)
  }
}

async function preloadImages() {
  await Promise.all(images.map(image => preload(image, false)))
  if (disposed) return
  if (typeof window.requestIdleCallback === 'function') {
    idleId = window.requestIdleCallback(() => { void preloadLargeImages() }, { timeout: 2000 })
  } else {
    backgroundTimer = window.setTimeout(() => { void preloadLargeImages() }, 200)
  }
}

onMounted(() => {
  ready.value = true
  if (document.readyState === 'complete') void preloadImages()
  else window.addEventListener('load', preloadImages, { once: true })
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('load', preloadImages)
  if (idleId !== undefined) window.cancelIdleCallback(idleId)
  window.clearTimeout(backgroundTimer)
  for (const finish of pendingPreloads) finish()
})

function openViewer(event: MouseEvent, index: number) {
  if (!ready.value || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  active.value = index
  viewerOpen.value = true
}

async function closeViewer() {
  viewerOpen.value = false
  await nextTick()
  carousel.value?.querySelectorAll<HTMLAnchorElement>('.full-size-link')[active.value]?.focus({ preventScroll: true })
}

function move(offset: number) {
  active.value = (active.value + offset + images.length) % images.length
}
</script>

<template>
  <section ref="carousel" aria-label="Product photos" class="carousel">
    <div v-for="(image, index) in images" :key="image.id">
      <figure v-show="!ready || index === active">
        <img
          :src="image.src" :srcset="image.srcset" :sizes="image.sizes"
          :width="image.width" :height="image.height" :alt="image.alt"
          :loading="index === 0 ? 'eager' : 'lazy'"
        >
        <figcaption>
          <a :href="image.full" class="full-size-link" :aria-haspopup="ready ? 'dialog' : undefined" @click="openViewer($event, index)">
            View full size<span class="sr-only">: {{ image.alt }}</span>
          </a>
        </figcaption>
      </figure>
    </div>
    <div v-if="ready" class="carousel-controls">
      <button type="button" @click="move(-1)">Previous</button>
      <p role="status" aria-live="polite" aria-atomic="true">{{ active + 1 }} of {{ images.length }}</p>
      <button type="button" @click="move(1)">Next</button>
    </div>
  </section>
  <PhotoViewer v-if="viewerOpen" v-model:index="active" :images="images" @close="closeViewer" />
</template>

<style scoped>
.carousel {
  width: 100%;
  max-width: 24rem;
  margin-inline: auto;
}

figure {
  margin-bottom: 1rem;
}

img {
  width: 100%;
}

figcaption {
  margin-top: 0.5rem;
  text-align: center;
}

.carousel-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}
</style>
