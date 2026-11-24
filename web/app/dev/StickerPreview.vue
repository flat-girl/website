<script setup lang="ts">
import FlatGirlSticker from '~/components/FlatGirlSticker.vue'
import StickerProof from './StickerProof.vue'
import ink from './flat-girl-print.webp'

useHead({ title: 'Holographic sticker · Flat Girl' })
</script>

<template>
  <StickerProof v-slot="{ x, y }" title="Holographic Flat Girl sticker">
    <FlatGirlSticker :x="x" :y="y" :ink="ink" />
  </StickerProof>
</template>
