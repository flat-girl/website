<script setup lang="ts">
import FlatGirlSticker from '~/components/FlatGirlSticker.vue'
import ink from './flat-girl-print.webp'

useHead({ title: 'Holographic sticker · Flat Girl' })

const x = ref(7)
const y = ref(19.9)

function setTilt(horizontal: number, vertical: number) {
  x.value = horizontal
  y.value = vertical
}
</script>

<template>
  <main class="preview">
    <h1>Holographic Flat Girl sticker</h1>
    <div class="stage">
      <FlatGirlSticker class="proof" :x="x" :y="y" :ink="ink" />
    </div>
    <div class="controls">
      <div class="axis">
        <label for="sticker-x">Horizontal tilt (X)</label>
        <output for="sticker-x">{{ x }}%</output>
        <input id="sticker-x" v-model.number="x" type="range" min="0" max="100" step="0.1" :aria-valuetext="`${x}%`">
      </div>
      <div class="axis">
        <label for="sticker-y">Vertical tilt (Y)</label>
        <output for="sticker-y">{{ y }}%</output>
        <input id="sticker-y" v-model.number="y" type="range" min="0" max="100" step="0.1" :aria-valuetext="`${y}%`">
      </div>
      <div class="poses">
        <button type="button" @click="setTilt(7, 19.9)">Upper left</button>
        <button type="button" @click="setTilt(89.9, 75.8)">Lower right</button>
        <button type="button" @click="setTilt(50, 50)">Reset tilt</button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.preview {
  width: min(37.667rem, 100% - 2rem);
  margin: clamp(1rem, 4vw, 3rem) auto;
}

h1 {
  margin-bottom: 1rem;
  font-size: clamp(1.35rem, 4vw, 2rem);
  letter-spacing: -0.035em;
}

.stage {
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  place-items: center;
  aspect-ratio: 602.672 / 585.648;
  max-height: 66svh;
  overflow: clip;
  background: conic-gradient(#ddd 25%, #f2f2f2 0 50%, #ddd 0 75%, #f2f2f2 0) 0 0 / 24px 24px;
}

.stage > .proof {
  width: 84.07%;
  height: 83.61%;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 2rem;
  margin-top: 1.25rem;
}

.axis {
  display: grid;
  grid-template-columns: 1fr auto;
  flex: 1 1 12rem;
  gap: 0.125rem 0.75rem;
}

output {
  font-variant-numeric: tabular-nums;
  color: #555;
}

input {
  grid-column: 1 / -1;
  width: 100%;
  height: 1.75rem;
  margin: 0;
  accent-color: #31303a;
  cursor: pointer;
}

button {
  min-height: 2.75rem;
}

.poses {
  display: flex;
  flex: 0 0 100%;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 36rem) {
  .controls {
    display: grid;
  }
}
</style>
