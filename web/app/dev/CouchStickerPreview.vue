<script setup lang="ts">
import CouchSticker from '~/components/CouchSticker.vue'
import StickerProof from './StickerProof.vue'

useHead({ title: 'Glitter couch sticker · Flat Girl' })
</script>

<template>
  <StickerProof v-slot="{ x, y }" title="Flat Girl + couch glitter sticker">
    <CouchSticker :x="x" :y="y" />
  </StickerProof>
</template>
