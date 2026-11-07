import { env } from 'node:process'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-05',
  devtools: { enabled: false },
  runtimeConfig: {
    public: {
      signupEndpoint: env.FLAT_GIRL_SIGNUP_ENDPOINT || '',
      turnstileSiteKey: env.FLAT_GIRL_TURNSTILE_SITE_KEY || '',
    },
  },
  $development: {
    runtimeConfig: {
      public: {
        signupEndpoint: env.FLAT_GIRL_SIGNUP_ENDPOINT || '/api/subscribe',
        // Cloudflare's public test key exercises the same verification UI locally.
        turnstileSiteKey: env.FLAT_GIRL_TURNSTILE_SITE_KEY || '1x00000000000000000000AA',
      },
    },
  },
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Boring Flat Girl',
      meta: env.FLAT_GIRL_NOINDEX === 'true' ? [{ name: 'robots', content: 'noindex, nofollow, noarchive' }] : [],
    },
  },
  nitro: {
    // Local API mocks run in dev; deployments contain only static assets.
    preset: 'static',
    prerender: { crawlLinks: false, failOnError: true, routes: ['/'] },
  },
  typescript: { strict: true },
})
