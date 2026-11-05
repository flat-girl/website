import metadata from '~/generated/images.json'

// Milestone 2 can supply a verified CDN origin while retaining these keys.
export function useImages(origin = ('origin' in metadata ? String(metadata.origin) : '')) {
  const url = (key: string) => `${origin.replace(/\/$/, '')}/${key}`
  return metadata.images.map(image => ({
    id: image.id,
    alt: image.alt,
    src: url(image.display[0]!.key),
    srcset: image.display.map(v => `${url(v.key)} ${v.width}w`).join(', '),
    sizes: '(max-width: 512px) calc(100vw - 32px), 480px',
    width: image.full.width,
    height: image.full.height,
    full: url(image.full.key),
  }))
}
