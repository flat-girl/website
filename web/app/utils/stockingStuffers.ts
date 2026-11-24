// Coordinates use the 0–100 range from the holographic sticker proof.
export function tiltTransform(x: number, y: number, rotation = 0, tiltDegrees = 12.5) {
  return `perspective(600px) rotateX(${(y - 50) / 50 * tiltDegrees}deg) rotateY(${(50 - x) / 50 * tiltDegrees}deg) rotateZ(${rotation}deg)`
}
