<script setup lang="ts">
import cutline from '~/assets/stocking-stuffers/couch-cutline.svg'
import exposedFoil from '~/assets/stocking-stuffers/couch-exposed-foil.png'
import opacityMap from '~/assets/stocking-stuffers/couch-print-opacity.png'
import ink from '~/assets/stocking-stuffers/couch-print.webp'
import whiteInk from '~/assets/stocking-stuffers/couch-white-ink.png'
import foil from '~/assets/stocking-stuffers/glitter-foil.webp'
import frames from '~/assets/stocking-stuffers/glitter-frames.webp'
import reflection from '~/assets/stocking-stuffers/laminate-reflection.webp'
import { tiltTransform } from '~/utils/stockingStuffers'

// The proof measures both axes from 0 to 100, starting at the top left.
const props = defineProps<{ x: number, y: number, rotation?: number, tiltDegrees?: number }>()
const id = useId()
const pose = computed(() => {
  const horizontal = props.x / 100 - 0.5
  const vertical = props.y / 100 - 0.5
  // The 4 × 3 sprite lights different flecks as the viewing angle changes.
  const frame = Math.abs(Math.ceil(horizontal * 48 - vertical * 24)) % 12
  return {
    transform: tiltTransform(props.x, props.y, props.rotation, props.tiltDegrees),
    filter: `drop-shadow(${horizontal * 60}px ${vertical * 30}px 10.7px rgb(0 0 30 / 30%))`,
    frameX: -(frame % 4) * 108,
    frameY: -Math.floor(frame / 4) * 108,
    foilX: -224.354 + horizontal * 448.707,
    foilY: -165.171 + vertical * 313.198,
    shineX: -448.707 + horizontal * 205.829,
    shineY: -772.114 + vertical * 205.829,
  }
})
</script>

<template>
  <svg
    class="sticker" viewBox="0 0 224.354 139.454" role="img"
    aria-label="Die-cut glitter sticker of Flat Girl on a couch"
    :style="{ transform: pose.transform, filter: pose.filter }"
  >
    <defs>
      <mask :id="`${id}-cut`">
        <image :href="cutline" width="100%" height="100%" />
      </mask>
      <mask :id="`${id}-white`"><image :href="whiteInk" width="100%" height="100%" /></mask>
      <!-- WebKit skips CSS inversion on a <use> inside a mask. Store the inverse alongside the white ink. -->
      <mask :id="`${id}-exposed`"><image :href="exposedFoil" width="100%" height="100%" /></mask>
      <mask :id="`${id}-opacity`"><image :href="opacityMap" width="100%" height="100%" /></mask>
      <pattern :id="`${id}-frames`" patternUnits="userSpaceOnUse" width="108" height="108">
        <image :href="frames" :x="pose.frameX" :y="pose.frameY" width="432" height="324" />
      </pattern>
      <mask :id="`${id}-flecks`"><rect width="100%" height="100%" :fill="`url(#${id}-frames)`" /></mask>
      <image
        :id="`${id}-shine`" :href="reflection" :x="pose.shineX" :y="pose.shineY"
        width="1121.768" height="1683.682" preserveAspectRatio="xMidYMid slice"
      />
    </defs>
    <g :mask="`url(#${id}-cut)`">
      <g :mask="`url(#${id}-exposed)`">
        <rect width="100%" height="100%" fill="#aaa" />
        <g :mask="`url(#${id}-flecks)`">
          <image :href="foil" :x="pose.foilX" :y="pose.foilY" width="673.061" height="469.797" />
        </g>
        <use :href="`#${id}-shine`" opacity="0.03" />
      </g>
      <g style="mix-blend-mode: color-burn">
        <rect width="100%" height="100%" fill="white" :mask="`url(#${id}-white)`" />
        <image :href="ink" width="100%" height="100%" :mask="`url(#${id}-opacity)`" />
      </g>
      <use :href="`#${id}-shine`" opacity="0.05" />
    </g>
  </svg>
</template>

<style scoped>
.sticker {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
