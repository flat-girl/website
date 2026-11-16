export const policyTags = ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'br', 'hr', 'ul', 'ol', 'li',
  'blockquote', 'a', 'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'] as const

export type PolicyNode = { type: 'text'; text: string } | {
  type: 'element'
  tag: typeof policyTags[number]
  children: PolicyNode[]
  href?: string
  start?: number
}

export function safePolicyHref(value: string): boolean {
  try {
    const url = new URL(value)
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}

export function isPolicyContent(value: unknown, depth = 0): value is PolicyNode[] {
  if (!Array.isArray(value) || depth > 64 || value.length > 10000) return false
  return value.every(node => {
    if (!node || typeof node !== 'object') return false
    if (node.type === 'text') return typeof node.text === 'string'
    return node.type === 'element' && policyTags.includes(node.tag)
      && (node.href === undefined || (node.tag === 'a' && typeof node.href === 'string' && safePolicyHref(node.href)))
      && (node.start === undefined || (node.tag === 'ol' && Number.isSafeInteger(node.start)))
      && isPolicyContent(node.children, depth + 1)
  })
}
