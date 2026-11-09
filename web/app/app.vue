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
  <main>
    <h1>Boring Flat Girl Plush Blanket</h1>
    <SarahCarousel />
    <div class="product-details">
      <p>Making plush blankets because we can't be the only ones who saw this commercial as kids.</p>
      <p>Doing a <strong>limited</strong> run of <strong>500</strong>; they will drop sometime in November, fulfilment by <strong>Christmas</strong>.</p>
      <p>$60, free shipping.</p>
    </div>
    <SignupForm />
  </main>
  <footer>
    <a href="https://linktree.polis.tv">A project by Polis</a>
  </footer>
</template>

<style scoped>
main {
  width: calc(100% - 2rem);
  max-width: 40rem;
  margin-inline: auto;
  padding-block: 1rem calc(3.5rem + env(safe-area-inset-bottom, 0px));
}

h1 {
  margin-bottom: 1rem;
  font-size: 1.875rem;
  line-height: 1.2;
  font-weight: 700;
  text-align: center;
}

.product-details {
  max-width: 28rem;
  margin: 2.5rem auto 0;
}

.product-details p + p {
  margin-top: 1rem;
}

footer {
  padding: 0 1.5rem calc(3rem + env(safe-area-inset-bottom, 0px));
  text-align: center;
}

@media (min-width: 48rem) {
  main {
    width: calc(100% - 4rem);
    padding-block: 2rem;
  }
}
</style>
