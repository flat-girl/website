import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-05',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'Boring Flat Girl',
      link: [{ rel: 'icon', href: 'data:,' }],
    },
  },
  nitro: {
    preset: 'static',
    prerender: { crawlLinks: false, failOnError: true, routes: ['/'] },
  },
  typescript: { strict: true },
})
