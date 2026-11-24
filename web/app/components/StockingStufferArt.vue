<script setup lang="ts">
import ink from '~/assets/stocking-stuffers/flat-girl-print-small.webp'
import { tiltTransform } from '~/utils/stockingStuffers'

const images = useImages()
const front = images.find(image => image.id === 'iou-front')
const back = images.find(image => image.id === 'iou-back')
if (!front || !back) throw new Error('The stocking stuffer artwork requires both IOU coupon images')

// Resting angles in degrees. Positive turns clockwise, negative counterclockwise.
const initialRotation = {
  iouFront: -12, // top left
  sarah: 16,     // top right
  couch: -8,     // bottom left
  iouBack: -5,   // bottom right
}

const frame = useTemplateRef('frame')
const scrollPhase = ref<number | null>(null)
const tiltDegrees = 8
let stopTracking: (() => void) | undefined

// Space the four offsets around the cycle so even a close random draw looks distinct.
const cycleStart = Math.random() * 2 * Math.PI
function piecePose(restingAngle: number, quarter: number, twistDirection: number) {
  const offset = cycleStart + (quarter + Math.random() * 0.5) * Math.PI / 2
  return computed(() => {
    if (scrollPhase.value === null) return { x: 50, y: 50, rotation: restingAngle }
    const phase = scrollPhase.value + offset
    return {
      x: 50 + 50 * Math.sin(phase),
      y: 50 - 45 * Math.cos(phase),
      rotation: restingAngle + twistDirection * 6 * Math.sin(phase + Math.PI / 4),
    }
  })
}

const frontPose = piecePose(initialRotation.iouFront, 0, 1)
const sarahPose = piecePose(initialRotation.sarah, 1, -1)
const couchPose = piecePose(initialRotation.couch, 2, 1)
const backPose = piecePose(initialRotation.iouBack, 3, -1)

onMounted(() => {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let pending = 0

  function updateTilt() {
    pending = 0
    if (!frame.value) return
    const { top, height } = frame.value.getBoundingClientRect()
    // Sweep the foil across the art as the purchase area enters and leaves the viewport.
    const progress = Math.max(0, Math.min(1, (window.innerHeight - top) / (height + window.innerHeight)))
    scrollPhase.value = progress * 4 * Math.PI
  }

  function scheduleTilt() {
    if (!pending) pending = requestAnimationFrame(updateTilt)
  }

  function stop() {
    window.removeEventListener('scroll', scheduleTilt)
    window.removeEventListener('resize', scheduleTilt)
    cancelAnimationFrame(pending)
    pending = 0
  }

  function syncMotion() {
    stop()
    if (motion.matches) {
      scrollPhase.value = null
      return
    }
    updateTilt()
    window.addEventListener('scroll', scheduleTilt, { passive: true })
    window.addEventListener('resize', scheduleTilt)
  }

  syncMotion()
  motion.addEventListener('change', syncMotion)
  stopTracking = () => {
    stop()
    motion.removeEventListener('change', syncMotion)
  }
})
onBeforeUnmount(() => stopTracking?.())
</script>

<template>
  <div ref="frame" class="stuffer-art" aria-hidden="true">
    <div class="corner front"><img :src="front.src" :srcset="front.srcset" sizes="(max-width: 30rem) 31vw, 9rem" alt="" :width="front.width" :height="front.height" :style="{ transform: tiltTransform(frontPose.x, frontPose.y, frontPose.rotation, tiltDegrees) }"></div>
    <div class="corner sarah"><FlatGirlSticker v-bind="sarahPose" :tilt-degrees="tiltDegrees" :ink="ink" /></div>
    <div class="corner couch"><CouchSticker v-bind="couchPose" :tilt-degrees="tiltDegrees" /></div>
    <div class="corner back"><img :src="back.src" :srcset="back.srcset" sizes="(max-width: 30rem) 31vw, 9rem" alt="" :width="back.width" :height="back.height" :style="{ transform: tiltTransform(backPose.x, backPose.y, backPose.rotation, tiltDegrees) }"></div>
  </div>
</template>

<style scoped>
.stuffer-art {
  position: absolute;
  inset-block: 0;
  left: 50%;
  transform: translateX(-50%);
  width: calc(100% + 0.75rem);
  z-index: 1;
  display: grid;
  grid-template: 1fr 1fr / 1fr 1fr;
  pointer-events: none;
}
.corner {
  width: clamp(5.5rem, 27vw, 9rem);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
}
.front { place-self: start; }
.sarah { place-self: start end; }
.couch { place-self: end start; }
.back { place-self: end; }
.couch, .back { translate: 0 var(--bottom-art-offset); }
.sarah > svg { width: auto; height: 100%; aspect-ratio: 147.582 / 215.847; }
.couch > svg { width: 100%; height: auto; }
.corner img { width: 100%; height: auto; filter: drop-shadow(0 2px 3px rgb(0 0 0 / 20%)); }
@media (max-width: 30rem) {
  .corner img { width: 112%; max-width: none; }
  .front img { justify-self: start; }
  .back img { justify-self: end; }
}
</style>
