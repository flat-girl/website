<script setup lang="ts">
const images = useImages()
const active = ref(0)
const ready = ref(false)
onMounted(() => { ready.value = true })
function move(offset: number) {
  active.value = (active.value + offset + images.length) % images.length
}
</script>

<template>
  <section aria-label="Sarah front and back" class="w-full max-w-[480px]">
    <div v-for="(image, index) in images" :key="image.id">
      <figure v-show="!ready || index === active" class="mb-4">
        <img
          :src="image.src" :srcset="image.srcset" :sizes="image.sizes"
          :width="image.width" :height="image.height" :alt="image.alt"
          :loading="index === 0 ? 'eager' : 'lazy'"
          class="h-auto w-full"
        >
        <figcaption class="mt-2">
          <a :href="image.full" target="_blank" rel="noopener" class="underline">
            View full size<span class="sr-only">: {{ image.alt }} (opens in a new tab)</span>
          </a>
        </figcaption>
      </figure>
    </div>
    <div v-if="ready" class="flex items-center gap-4">
      <button type="button" @click="move(-1)">Previous</button>
      <p role="status" aria-live="polite" aria-atomic="true">{{ active + 1 }} of {{ images.length }}</p>
      <button type="button" @click="move(1)">Next</button>
    </div>
  </section>
</template>
