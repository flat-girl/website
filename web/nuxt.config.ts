import { env } from 'node:process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { policyLinks } from './app/content/storefront'

const faviconVersion = createHash('sha256')
  .update(readFileSync(new URL('./public/favicon.ico', import.meta.url)))
  .digest('hex').slice(0, 12)

const commerceSource = env.FLAT_GIRL_COMMERCE_SOURCE || 'local'
if (!['local', 'shopify'].includes(commerceSource)) throw new Error('FLAT_GIRL_COMMERCE_SOURCE must be local or shopify')

if (env.FLAT_GIRL_STOREFRONT_MODE && !['waitlist', 'commerce'].includes(env.FLAT_GIRL_STOREFRONT_MODE)) {
  throw new Error('FLAT_GIRL_STOREFRONT_MODE must be waitlist or commerce')
}
if (env.FLAT_GIRL_COMMERCE_ENDPOINT) {
  const endpoint = new URL(env.FLAT_GIRL_COMMERCE_ENDPOINT)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port
    || ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) || endpoint.search || endpoint.hash) {
    throw new Error('Published commerce endpoints must use a remote HTTPS URL')
  }
}
const checkoutHosts = 'tepwtx-zw.myshopify.com,flatgirl.myshopify.com,shopify.flatgirl.net'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-05',
  devtools: { enabled: false },
  runtimeConfig: {
    // Private Storefront token never enters public runtime config.
    shopifyStorefrontToken: '',
    public: {
      signupEndpoint: env.FLAT_GIRL_SIGNUP_ENDPOINT || '',
      turnstileSiteKey: env.FLAT_GIRL_TURNSTILE_SITE_KEY || '',
      storefrontMode: env.FLAT_GIRL_STOREFRONT_MODE || 'waitlist',
      commerceSource: 'shopify',
      // Only the PUBLIC Storefront token may be exposed to the browser.
      shopifyStorefrontPublicToken: env.NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN || '',
      commerceEndpoint: env.FLAT_GIRL_COMMERCE_ENDPOINT || '',
      checkoutHosts,
    },
  },
  $development: {
    hooks: {
      'pages:extend'(pages) {
        pages.push({
          name: 'flat-girl-sticker',
          path: '/flat-girl-sticker',
          file: fileURLToPath(new URL('./app/dev/StickerPreview.vue', import.meta.url)),
        })
        pages.push({
          name: 'couch-sticker',
          path: '/couch-sticker',
          file: fileURLToPath(new URL('./app/dev/CouchStickerPreview.vue', import.meta.url)),
        })
      },
    },
    runtimeConfig: {
      public: {
        signupEndpoint: '/api/subscribe',
        commerceEndpoint: '/api/commerce',
        storefrontMode: 'commerce',
        commerceSource,
        // Cloudflare's public test key exercises the same verification UI locally.
        turnstileSiteKey: '1x00000000000000000000AA',
      },
    },
  },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Boring Flat Girl',
      link: [{
        rel: 'icon',
        type: 'image/x-icon',
        sizes: '16x16 32x32 48x48',
        href: `/favicon.ico?v=${faviconVersion}`,
      }],
      meta: env.FLAT_GIRL_NOINDEX === 'true' ? [{ name: 'robots', content: 'noindex, nofollow, noarchive' }] : [],
    },
  },
  nitro: {
    // Local API mocks run in dev; deployments contain only static assets.
    preset: 'static',
    prerender: { crawlLinks: false, failOnError: true, routes: ['/', ...policyLinks.map(p => `/policies/${p.handle}/`)] },
  },
  hooks: {
    'nitro:config'(config) {
      if (config.dev) return
      // Check Nuxt overrides too: static hosting cannot supply a private fallback.
      const mode = env.NUXT_PUBLIC_STOREFRONT_MODE ?? env.FLAT_GIRL_STOREFRONT_MODE ?? 'waitlist'
      const token = env.NUXT_PUBLIC_SHOPIFY_STOREFRONT_PUBLIC_TOKEN || ''
      if (!['waitlist', 'commerce'].includes(mode)
        || (env.NUXT_PUBLIC_COMMERCE_SOURCE ?? 'shopify') !== 'shopify'
        || (env.NUXT_PUBLIC_COMMERCE_ENDPOINT ?? env.FLAT_GIRL_COMMERCE_ENDPOINT ?? '') !== ''
        || (env.NUXT_PUBLIC_CHECKOUT_HOSTS ?? checkoutHosts) !== checkoutHosts) {
        throw new Error('Static storefronts require Shopify public access and the configured checkout hosts; no commerce endpoint')
      }
      if ((mode === 'commerce' && !token) || (token && (!/^[a-zA-Z0-9_-]{16,256}$/.test(token)
        || /^shp/i.test(token) || token === env.NUXT_SHOPIFY_STOREFRONT_TOKEN))) {
        throw new Error('Commerce builds require a public Storefront token; private/Admin tokens are not publishable')
      }
    },
  },
  typescript: { strict: true },
})
