<script setup lang="ts">
import cutline from '~/assets/stocking-stuffers/flat-girl-cutline.svg'
import foil from '~/assets/stocking-stuffers/holographic-foil.webp'
import reflection from '~/assets/stocking-stuffers/laminate-reflection.webp'
import { tiltTransform } from '~/utils/stockingStuffers'

// Slider positions in percent, measured from the top-left of the proof.
const props = defineProps<{ x: number, y: number, ink: string, rotation?: number, tiltDegrees?: number }>()
const maskId = useId()
const pose = computed(() => {
  const horizontal = props.x / 100 - 0.5
  const vertical = props.y / 100 - 0.5
  return {
    transform: tiltTransform(props.x, props.y, props.rotation, props.tiltDegrees),
    filter: `drop-shadow(${horizontal * 60}px ${vertical * 30}px 10.5px rgb(0 0 30 / 30%))`,
    // Offsets in the proof's SVG coordinate system, centered at neutral tilt.
    foilX: -390.063 + horizontal * 618.472,
    foilY: -215.847 + vertical * 431.694,
    shineX: -295.164 + horizontal * 135.397,
    shineY: -445.849 + vertical * 135.397,
  }
})
</script>

<template>
  <svg
    class="sticker" viewBox="0 0 147.582 215.847" role="img"
    aria-label="Die-cut holographic Flat Girl sticker"
    :style="{ transform: pose.transform, filter: pose.filter }"
  >
    <defs>
      <mask :id="maskId" maskUnits="userSpaceOnUse" x="0" y="0" width="147.582" height="215.847">
        <image :href="cutline" width="147.582" height="215.847" />
      </mask>
      <image
        :id="`${maskId}-shine`" :href="reflection" :x="pose.shineX" :y="pose.shineY"
        width="737.911" height="1107.544" preserveAspectRatio="xMidYMid slice"
      />
    </defs>
    <g :mask="`url(#${maskId})`">
      <rect width="147.582" height="215.847" fill="white" />
      <image :href="foil" :x="pose.foilX" :y="pose.foilY" width="927.708" height="647.54" />
      <use :href="`#${maskId}-shine`" opacity="0.03" />
      <image class="ink" :href="ink" width="147.582" height="215.847" />
      <use :href="`#${maskId}-shine`" opacity="0.05" />
    </g>
  </svg>
</template>

<style scoped>
.sticker {
  display: block;
  width: 100%;
  height: 100%;
}

.ink {
  mix-blend-mode: multiply;
}
</style>
