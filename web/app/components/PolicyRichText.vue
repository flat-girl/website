<script lang="ts">
import { defineComponent, h, type PropType, type VNodeChild } from 'vue'
import { isPolicyContent, type PolicyNode } from '#shared/utils/policy'

// Remote policies use validated elements and escaped text. trustedHtml is only
// for author-written notes in storefront.ts, never API responses or user input.
export default defineComponent({
  props: {
    content: { type: Array as PropType<PolicyNode[]>, default: () => [] },
    trustedHtml: { type: String, default: undefined },
  },
  setup(props) {
    function render(node: PolicyNode): VNodeChild {
      if (node.type === 'text') return node.text
      const attributes: Record<string, string | number> = {}
      if (node.tag === 'a' && node.href) attributes.href = node.href
      if (node.tag === 'ol' && node.start !== undefined) attributes.start = node.start
      return h(node.tag, attributes, node.children.map(render))
    }
    return () => props.trustedHtml !== undefined
      ? h('div', { class: 'policy-content', innerHTML: props.trustedHtml })
      : h('div', { class: 'policy-content' }, isPolicyContent(props.content) ? props.content.map(render) : [])
  },
})
</script>

<style scoped>
.policy-content { margin-top: 1rem; }
.policy-content :deep(p) { margin-block: 1rem; }
.policy-content :deep(h1), .policy-content :deep(h2) { margin: 1.5rem 0 .75rem; font-size: 1.5rem; line-height: 1.3; }
.policy-content :deep(h3), .policy-content :deep(h4), .policy-content :deep(h5), .policy-content :deep(h6) { margin: 1.25rem 0 .5rem; font-size: 1.125rem; line-height: 1.4; }
.policy-content :deep(ul), .policy-content :deep(ol) { margin-block: 1rem; padding-left: 1.5rem; }
.policy-content :deep(li + li) { margin-top: .375rem; }
.policy-content :deep(blockquote) { margin: 1rem 0; border-left: 2px solid #bbb; padding-left: 1rem; }
.policy-content :deep(pre) { white-space: pre-wrap; }
.policy-content :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin-block: 1rem; }
.policy-content :deep(td), .policy-content :deep(th) { border: 1px solid #ccc; padding: .5rem; text-align: left; }
</style>
