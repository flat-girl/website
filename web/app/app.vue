<script setup lang="ts">
import metadata from '~/generated/images.json'

const origin = 'origin' in metadata ? String(metadata.origin).replace(/\/$/, '') : ''
useHead({
  link: metadata.images.filter(image => image.recipe === 'favicon').flatMap(image =>
    image.variants.map(variant => {
      const attributes = {
        type: 'image/png',
        sizes: `${variant.width}x${variant.height}`,
        href: `${origin}/${variant.key}`,
      }
      return variant.width === 180
        ? { ...attributes, rel: 'apple-touch-icon' as const }
        : { ...attributes, rel: 'icon' as const }
    }),
  ),
})
</script>

<template>
  <main class="p-4">
    <h1 class="mb-4 text-3xl font-bold">Boring Flat Girl</h1>
    <SarahCarousel />
    <SignupForm />
  </main>
</template>
