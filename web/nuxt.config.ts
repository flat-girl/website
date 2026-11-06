import tailwindcss from '@tailwindcss/vite'
import { env } from 'node:process'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-05',
  devtools: { enabled: false },
  runtimeConfig: {
    public: {
      signupEnabled: env.FLAT_GIRL_SIGNUP_ENABLED === 'true',
      signupEndpoint: env.FLAT_GIRL_SIGNUP_ENDPOINT || '',
      turnstileSiteKey: env.FLAT_GIRL_TURNSTILE_SITE_KEY || '',
      signupEnvironment: env.FLAT_GIRL_SIGNUP_ENVIRONMENT || 'local',
    },
  },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
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
