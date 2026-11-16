import { env } from 'node:process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
if (env.FLAT_GIRL_STOREFRONT_MODE === 'commerce' && !env.FLAT_GIRL_COMMERCE_ENDPOINT) {
  throw new Error('Commerce builds require FLAT_GIRL_COMMERCE_ENDPOINT')
}

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
      checkoutHosts: 'tepwtx-zw.myshopify.com,flatgirl.myshopify.com',
    },
  },
  $development: {
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
  typescript: { strict: true },
})
