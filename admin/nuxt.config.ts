import tailwindcss from '@tailwindcss/vite'
export default defineNuxtConfig({
  compatibilityDate: '2026-11-08',
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  app: { head: { title: 'Flat Girl · Dashboard', htmlAttrs: { lang: 'en' }, meta: [{ name: 'robots', content: 'noindex, nofollow, noarchive' }] } },
  nitro: { preset: 'static', prerender: { crawlLinks: false, failOnError: true, routes: ['/'] } },
  typescript: { strict: true },
})
